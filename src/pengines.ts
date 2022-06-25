import pl, { ErrorInfo } from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeError, functor, toProlog } from "./prolog";
import { PrologDO } from "./prolog-do";
import { Store } from "./unholy";
import { PengineResponse, formatResponse, prologResponse, serializeTerm } from "./response";
import { Env } from ".";
import { renderResult } from "./views/result";
import { HTMLResponse } from "@worker-tools/html";

export const DEFAULT_APPLICATION = "pengine_sandbox";
export const ARBITRARY_HIGH_NUMBER = 100;
export const PENGINES_DEBUG = true;

export type Format = "json" | "prolog" | "json_atom" | "raw";
export type Command = "create" | "destroy" | "ask" | "next" | "stop" | "ping";
export type Event = "create" | "destroy" | "success" | "failure" | "error" | "stop" | "ping";

export interface PengineRequest {
	id: string,
	application: string,
	ask: string,
	template: pl.type.Value,
	src_text: string,
	src_url: string,
	chunk: number,
	format: Format,
	create: boolean,
	destroy: boolean,
	stop: boolean,
	next: boolean,
	cmd: Command;
}

export interface PengineReply {
	event: Event,
	id: string,
	lifecycle?: "create" | "destroy" | "full",
	output?: string,

	ask?: string,
	results?: pl.type.Value[],
	more?: boolean,
	projection?: pl.type.Term<number, string>[], // atoms
	time?: number, // time taken
	
	error?: pl.type.Value, // value from throw/1
	links?: pl.type.Substitution[],
	
	meta?: PengineMetadata,
	debug?: {
		dump?: Record<string, string>,
		error?: ErrorInfo,
	},
	slave_limit?: number,
}

export interface PengineMetadata {
	src_text?: string,
	src_urls: string[],
	title: string,

	application?: string,
	app_src?: string,
	listeners?: string[]
}

export class PengineDO extends PrologDO {
	consulted_urls: string[] = [];
	req?: Partial<PengineRequest>;

	points: Store<pl.type.State[]>;
	query: Store<Partial<PengineRequest>>;
	meta: Store<PengineMetadata>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.points = new Store(this.state.storage, "points", pl.type);
		this.query = new Store(this.state.storage, "query", pl.type);
		this.meta = new Store(this.state.storage, "meta", pl.type);
		this.onmessage = async (id: string, from: string, raw: any) => {
			const msg = JSON.parse(raw) as SocketMessage;
			this.handleMessage(id, from, msg);
		}
	}

	async fetch(request: Request) {
		const url = new URL(request.url);

		const id = url.searchParams.get("id") ?? url.host;
		this.setID(id);

		console.log("request:", url.pathname, id);

		if (request.headers.get("Upgrade") == "websocket") {
			return this.handleWebsocket(id, request, crypto.randomUUID());
		}

		switch (url.pathname) {
		case "/robots.txt":
		case "/favicon.ico":
			return new Response("no", { status: 404 });
		case "/pengine/create":
		case "/pengine/send":
			return this.pengineHandle(request);
		case "/pengine/ping":
			return this.penginePing(request);
		case "/meta":
			return this.handleMeta(request);
		default:
			console.log("404:", url.pathname);
			return new Response("not found", { status: 404 });
		}
	}

	async handleMeta(request: Request): Promise<Response> {
		const resp = await this.meta.get() ?? {};
		return new JSONResponse(resp);
	}

	async loadState(): Promise<[Partial<PengineRequest> | undefined, pl.type.State[]]> {
		const req = await this.query.get();
		const next = await this.points.get() ?? [];
		return [req, next];
	}

	async saveState(req: Partial<PengineRequest>, pts: pl.type.State[]) {
		if (pts.length > 0) {
			this.query.put(req);
			this.points.put(pts);
			return true; // more
		}
		this.points.delete();
		return false; // no more
	}

	async deleteState() {
		await Promise.all([this.points.delete(), this.query.delete()]);
	}

	async exec(id: string, req: Partial<PengineRequest>, start: number, persist: boolean): Promise<PengineReply> {
		const meta: PengineMetadata = (await this.meta.get()) ?? {src_urls: [], title: ""};
		const [parentReq, next] = await this.loadState();

		if (req.stop) {
			console.log("TODO: stop", req);	
			if (persist) {
				this.save();
				await this.deleteState();
			}
			return {
				event: "stop",
				id: id,
				meta: meta,
			};
		}
		if (req.destroy) {
			console.log("TODO: destroy", req);
			if (persist) {
				this.save();
			}
			return {
				event: "destroy",
				id: id,
				meta: meta,
			};
		}

		// synchronize with Pengine application DO
		if (req.application && req.application != DEFAULT_APPLICATION) {
			meta.application = req.application;
			await this.linkApp(req.application);
		}

		if (req.src_url && !meta.src_urls.includes(req.src_url)) {
			this.dirty = true;
			meta.src_urls.push(req.src_url);
		}

		if (this.dirty || req.src_text) {
			this.pl.resetRules();
		}

		for (const url of meta.src_urls) {
			if (!this.consulted_urls.includes(url)) {
				const resp = await fetch(new Request(url));
				if (resp.status != 200) {
					throw makeError("consult_error", functor("http_status", resp.status), functor("src_url", url));
				}
				const prog = await resp.text();

				console.log("consulted url", url, prog.slice(0, 64));
				await this.pl.consult(prog, {
					session: this.pl.session,
					from: url,
					reconsult: true,
					url: false,
					html: false,
					success: () => {
						console.log("consulted url:", url, prog.length);
						this.consulted_urls.push(url);
					},
					error: (err: unknown) => {
						console.error("invalid src_url text:", prog);
						throw makeError("consult_error", err, functor("src_url", url));
					}
				});
				this.dirty = true;
			} else {
				console.log("already loaded:", url);
			}
		}

		if (req.src_text) {
			const same = req.src_text == meta.src_text;
			await this.pl.consult(req.src_text, {
				session: this.pl.session,
				reconsult: true,
				url: false,
				html: false,
				success: () => {
					meta.src_text = req.src_text;
				}
			});
			if (!same) {
				this.dirty = true;
			}
		}

		if (!req.ask && !req.next) {
			if (persist) {
				this.meta.put(meta);
				this.save();
			}
			return {
				event: "create",
				id: id,
				slave_limit: ARBITRARY_HIGH_NUMBER,
				meta: meta,
			};
		}

		// console.log("Ask:", req, "SESH", this.sesh, "NEXT?", next);
		this.req = req;

		const chunk = req.chunk ?? this.req?.chunk;
		const [query, answers] = await this.run(req.ask ?? next, chunk, false);

		const results: pl.type.Value[] = [];
		const links: pl.type.Substitution[] = [];
		let projection: pl.type.Term<number, string>[] = [];
		let queryGoal: pl.type.Value | undefined;
		let rest: pl.type.State[] = [];
		for await (const [goal, answer] of answers) {
			const tmpl: pl.type.Value = req.template ?? goal;
			if (pl.type.is_error(answer)) {
				const ball = answer.args[0];
				if (pl.type.is_term(ball) && ball.indicator === "stop/0") {
					// await this.deleteState(query.id);
					return {
						event: "stop",
						id: `${id}_${query.id}`,
						meta: meta,
						output: query.output(),
						debug: PENGINES_DEBUG ? {dump: this.dumpAll()} : undefined,
					};
				}
				const event: PengineReply = {
					event: "error",
					id: id,
					error: ball,
					meta: meta,
					output: query.output(),
					debug: PENGINES_DEBUG ? {dump: this.dumpAll()} : undefined,
				};
				return event;
			} else if (pl.type.is_substitution(answer)) {
				if (!queryGoal && answer.links) {
					queryGoal = goal;
					projection = Object.keys(answer.links).
						filter(x => !x.startsWith("_")).
						map(x => new pl.type.Term(x, []));
				}
				const term = tmpl.apply(answer);
				results.push(term);
				links.push(answer);
			} else {
				throw new Error(`weird answer: %{answer}`);
			}
		}
		rest = query.thread.points;
		const output = query.output();

		if (persist) {
			this.meta.put(meta);
			this.save();
		}
		const more = await this.saveState(parentReq ?? req, rest);

		const end = Date.now();
		const time = (end - start) / 1000;
		const debug = PENGINES_DEBUG ? {dump: this.dumpAll()} : undefined;

		let event: PengineReply;
		if (results.length == 0) {
			event = {
				event: "failure",
				id: id,
				time: time,
				output: output,
				meta: meta,
				ask: req.ask,
				debug: debug,
			};
		} else {
			event = {
				event: "success",
				results: results,
				links: links, // TODO: fix this
				id: id,
				more: more,
				projection: projection,
				time: time,
				slave_limit: ARBITRARY_HIGH_NUMBER,
				output: output,
				meta: meta,
				ask: req.ask,
				debug: debug,
			};
		}


		if (!more && req.destroy) {
			event.lifecycle = "destroy";
		}

		if (!parentReq && req.create) {
			event.lifecycle = "create";
		}

		return event;
	}

	async penginePing(request: Request) {
		const url = new URL(request.url);
		const format = url.searchParams.get("format") || "prolog";
		const id = url.searchParams.get("id") || "default";

		if (format == "prolog") {
			const resp = `create('${id}', [slave_limit(100000)]).\n`;
			return prologResponse(resp);
		}

		const resp = {
			event: "create",
			id: id,
			slave_limit: 100000
		};
		return new JSONResponse(resp);
	}

	async pengineHandle(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const start = Date.now();
		let msg!: Partial<PengineRequest>;
		let format = url.searchParams.get("format") as Format;
		const create = url.pathname == "/pengine/create";

		switch (request.method) {
		case "POST":
			const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
			if (contentType.includes("application/json")) {
				msg = await parseAskJSON(this.pl, await request.json());
			} else if (contentType.includes("prolog")) {
				msg = await parseAsk(this.pl, await request.text());
			} else {
				return new Response("Unsupported Media Type", { status: 415 });
			}
			break;
		case "GET":
			msg = await parseAskForm(this.pl, url.searchParams);
			break;
		deafult:
			return new Response("bad method", { status: 405 });
		}

		if (!format && msg.format) {
			format = msg.format;
		} else if (!format) {
			format = "prolog";
		}
		msg.create = create;

		if (!msg.application) {
			msg.application = DEFAULT_APPLICATION;
		}

		const id = url.searchParams.get("pengines_id") ?? msg.id ?? this.state.id.toString();
		// const persist = id !== DEFAULT_APPLICATION; // TODO
		const persist = true;

		try {
			const resp = await this.exec(id, msg, start, persist);
			return formatResponse(format, resp, this.pl);
		} catch(err) {
			if (err instanceof Error) {
				throw(err);
			}

			const ball = pl.type.is_error(err) ? err : toProlog(err);
			return formatResponse(format, {
				event: "error",
				id: id,
				error: ball as pl.type.Term<number, string>,
			})
			if (format == "json") {

				const resp = {
					"data": serializeTerm(ball, this.pl),
					"event": "error",
					"id": id,
				};
				return new JSONResponse(resp);
			}
			const idTerm = new pl.type.Term(id, []);
			const msg = new pl.type.Term("error", [idTerm, ball]);
			const text = msg.toString({session: this.pl.session, quoted: true, ignore_ops: false }) + ".\n";
			return prologResponse(text);
		}
	}

	async handleMessage(id: string, from: string, msg: SocketMessage) {
		switch (msg.cmd) {
		case "hello":
			break;
		case "query":
			const req = await parseAskJSON(this.pl, msg.query);
			req.id = id;
			req.format = "json";

			try {
				const result = await this.exec(id, req, Date.now(), true);
				const resp = await formatResponse("json", result, this.pl).json();
				const html = await (new HTMLResponse(renderResult(resp as PengineResponse, true))).text();
				this.broadcast("result:" + html);
			} catch(err) {
				if (err instanceof Error) {
					throw(err);
				}
				const ball = toProlog(err);
				const resp: PengineResponse = {
					event: "error",
					id: id,
					meta: await this.meta.get(),
					data: serializeTerm(ball, this.pl),
				};
				const html = await (new HTMLResponse(renderResult(resp, true))).text();
				this.broadcast("result:" + html);
			}
		}
	}
}

function fixQuery(query?: string): string | undefined {
	if (!query) {
		return undefined;
	}
	query = query.trim();
	if (!query.endsWith(".")) {
		query += ".";
	}
	return query;
}

async function parseAskJSON(sesh: Prolog, obj: any): Promise<Partial<PengineRequest>> {
	const req: Partial<PengineRequest> = {
		id: obj.id,
		ask: fixQuery(obj.ask),
		src_text: obj.src_text,
		src_url: obj.src_url,
		format: obj.format,
		application: obj.application || DEFAULT_APPLICATION,
		chunk: obj.chunk,
	};
	if (obj.template) {
		req.template = await parseTerm(sesh, obj.template);
	}
	return req;
}

async function parseAskForm(sesh: Prolog, form: URLSearchParams): Promise<Partial<PengineRequest>> {
	const req: Partial<PengineRequest> = {
		id: form.get("id") ?? undefined,
		ask: fixQuery(form.get("ask") ?? undefined),
		src_text: form.get("src_text") ?? undefined,
		src_url: form.get("src_url") ?? undefined,
		format: form.get("format") as Format ?? undefined,
		application: form.get("application") || DEFAULT_APPLICATION,
		chunk: form.get("chunk") ? Number(form.get("chunk")) : undefined,
	};
	if (form.get("template")) {
		req.template = await parseTerm(sesh, form.get("template")!);
	}
	return req;
}

async function parseTerm(sesh: Prolog, raw: string): Promise<pl.type.Value> {
	// const thread = new pl.type.Thread(pl.sesh.session);
	raw = raw.trim();
	if (raw.endsWith(".")) {
		raw = raw.slice(0, -1);
	}
	raw = `ParsedTermXX = (${raw}).`;
	const answers = sesh.query(raw);
	let term;
	for await (const [_, answer] of answers) {
		if (pl.type.is_error(answer)) {
			throw answer;
		}
		term = (answer as pl.type.Substitution).links["ParsedTermXX"];
		break;
	}
	if (!term) {
		throw "couldn't parse raw";
	}
	return term as pl.type.Value;
}

async function parseAsk(sesh: Prolog, ask: string): Promise<Partial<PengineRequest>> {
	// ask(('メンバー'(X, ['あ', 1, Y])), [destroy(false),src_text('\'メンバー\'(X, List) :- member(X, List).\n')])
	const term = await parseTerm(sesh, ask) as pl.type.Term<number, string>;

	switch (term.indicator) {
	case "destroy/0":
		return { destroy: true };
	case "stop/0":
		return { stop: true };
	case "ask/2":
		break;
	case "next/0":
		return { next: true };
	default:
		throw "unsupported send: " + term.indicator;
	}

	const result: Partial<PengineRequest> = {
		ask: fixQuery(term.args[0].toString({ session: sesh.session, quoted: true, ignore_ops: false })),
	};

	let arg: pl.type.Term<number, string> = term.args[1] as pl.type.Term<number, string>;
	while (arg.indicator !== "[]/0") {
		const lhs = arg.args[0] as pl.type.Term<number, string>;
		const rhs = lhs.args[0] as pl.type.Term<number, string>
		switch (lhs.indicator) {
		case "id/1":
			result.id = rhs.id;
			break;
		case "src_text/1":
			result.src_text = rhs.id;
			break;
		case "destroy/1":
			result.destroy = rhs.id === "true";
			break;
		case "template/1":
			result.template = await parseTerm(sesh, rhs.id);
			break;
		case "format/1":
			result.format = rhs.id as Format;
			break;
		case "application/1":
			result.application = rhs.id;
			break;
		case "chunk/1":
			result.chunk = (lhs.args[0] as pl.type.Num).value;
			break;
		case undefined:
			throw "invalid ask:" + ask;
		default:
			console.log("unhandled ask option:", lhs.toString(), rhs.toString());
		}
		arg = arg.args[1] as pl.type.Term<number, string>;
	}

	return result;
}

interface SocketMessage {
	cmd: "hello" | "query",
	query?: PengineRequest
}