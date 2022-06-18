import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeError, functor, toProlog, Query } from "./prolog";
import { dumpModule, PrologDO } from "./prolog-do";
import { Store } from "./unholy";
import { ErrorEvent, formatResponse, PengineResponse, prologResponse, serializeTerm } from "./response";
import { Env } from ".";
import { renderResult } from "./views";
import { BufferedHTMLResponse, HTMLResponse } from "@worker-tools/html";

export const DEFAULT_APPLICATION = "pengine_sandbox";
export const ARBITRARY_HIGH_NUMBER = 100;
export const MAGIC_MODULES = ["app"];

export interface PengineRequest {
	id: string,
	application: string,
	ask: string,
	template: pl.type.Value,
	src_text: string,
	src_url: string,
	chunk: number,
	format: "json" | "prolog",
	create: boolean,
	destroy: boolean,
	stop: boolean,
	next: boolean,
	cmd: "create" | "destroy" | "ask" | "next" | "stop";
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
	env: Env;
	consulted_urls: string[] = [];
	req?: Partial<PengineRequest>;

	points: Store<pl.type.State[]>;
	query: Store<Partial<PengineRequest>>;
	meta: Store<PengineMetadata>;

	appSocket?: WebSocket;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.env = env;
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
		console.log("request:", url.pathname, url.searchParams.get("id"));

		if (request.headers.get("Upgrade") == "websocket") {
			return this.handleWebsocket(url.searchParams.get("id"), request, crypto.randomUUID());
		}

		switch (url.pathname) {
		case "/favicon.ico":
			return new Response("no", { status: 404 });
		case "/":
			// test homepage
			break;
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

	async exec(id: string, req: Partial<PengineRequest>, start: number, persist: boolean): Promise<PengineResponse> {
		const meta: PengineMetadata = (await this.meta.get()) ?? {src_urls: [], title: ""};
		const [parentReq, next] = await this.loadState();

		if (req.stop) {
			console.log("TODO: stop", req);	
			if (persist) {
				this.save(MAGIC_MODULES);
				// TODO: this.deleteState(id);
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
				this.save(MAGIC_MODULES);
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
			const app = this.env.PENGINES_APP_DO.get(
				this.env.PENGINES_APP_DO.idFromName(req.application));
			
			// TODO: websocket stuff
			{
				console.log("RDY?", this.appSocket, this.appSocket?.readyState);
				if (!this.appSocket || this.appSocket.readyState !== 1) {
					const resp = await app.fetch(`http://${req.application}/${id}`, {
						headers: {
							Upgrade: "websocket",
						},
					});

					const ws = resp.webSocket;
					if (!ws) {
						throw new Error("server didn't accept WebSocket");
					}

					ws.accept();
					this.appSocket = ws;
					console.log("connected to websocket", ws, req.application);

					ws.send("hello");
					ws.addEventListener("message", (msg: MessageEvent) => {
						console.log("upd88:", msg.data);
						const promise = msg.data === "true." ? 
							this.syncApp(app, req, meta) : 
							this.run(msg.data);
						promise.then(() => {
							this.broadcast(`update:${msg.data}`);
						});
					});
					await this.syncApp(app, req, meta);
				}
			}	
		}

		if (req.src_url && !meta.src_urls.includes(req.src_url)) {
			meta.src_urls.push(req.src_url);
		}

		for (const url of meta.src_urls) {
			if (!this.consulted_urls.includes(url)) {
				const resp = await fetch(new Request(url));
				if (resp.status != 200) {
					throw makeError("consult_error", functor("bad_status", resp.status), url);
				}
				const prog = await resp.text();

				console.log("consulted url", url, prog.slice(0, 64));
				this.pl.session.consult(prog, {
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
			} else {
				console.log("already loaded:", url);
			}
		}

		if (req.src_text) {
			this.pl.session.consult(req.src_text, {
				session: this.pl.session,
				// from: "$src_text",
				reconsult: true,
				url: false,
				html: false,
				success: () => {
					meta.src_text = req.src_text;
					console.log("consulted text:", req.src_text);
					this.broadcast(`src_text:${req.src_text}`);
				},
				error: (err: unknown) => {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		if (!req.ask && !req.next) {
			if (persist) {
				this.meta.put(meta);
				this.save(MAGIC_MODULES);
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

		// const answers = this.sesh.query(req.ask);
		let query: Query;
		if (req.ask) {
			query = new Query(this.pl.session, req.ask);
		} else {
			query = new Query(this.pl.session, next);
		}
		const answers = query.answer();
		const results = [];
		const links = [];
		const chunk = req.chunk ?? this.req?.chunk;
		let projection: any[] = [];
		let queryGoal: pl.type.Value | undefined;
		let rest: pl.type.State[] = [];
		for await (const [goal, answer] of answers) {
			const tmpl: pl.type.Value = req.template ?? goal;
			if (answer.indicator == "throw/1") {
				const resp: ErrorEvent = {
					event: "error",
					id: id,
					data: answer.args[0],
					meta: meta,
					output: query.output(),
				};
				return resp;
			}

			if (!queryGoal && answer.links) {
				queryGoal = goal;
				projection = Object.keys(answer.links).
					filter(x => !x.startsWith("_")).
					map(x => new pl.type.Term(x, []));
			}

			const term = tmpl.apply(answer);
			results.push(term);
			links.push(answer.links);

			if (chunk == results.length) {
				console.log("chunkin'", req.chunk, rest, "SESH", this.pl);
				break;
			}
		}
		rest = query.thread.points;
		const output = query.output();

		const tx = query.tx();
		if (tx) {
			const appTx = [];
			for (const op of tx) {
				console.log("TX OP:", op.toString(), "APP", req.application);
				if (op.args[0]?.indicator == ":/2" && op.args[0]?.args[0] == "app") {
					appTx.push(op);
				}
			}
			if (req.application && req.application != DEFAULT_APPLICATION && appTx.length > 0) {
				const txQuery = tx.map(t => t.toString({session: this.pl.session, quoted: true, ignore_ops: true})).join("; ") + ".";
				console.log("TX query:", txQuery);
				const app = this.env.PENGINES_APP_DO.get(
					this.env.PENGINES_APP_DO.idFromName(req.application));
				const update = new Request(`http://${req.application}/exec`, {
					method: "POST",
					body: txQuery,
					headers: {
						"Pengine": id,
					},
				});
				const result = await app.fetch(update);
				if (!result.ok) {
					throw("TX FAILED");
				}
				meta.app_src = await result.text();	
				this.broadcast(`update:${txQuery}`);
			}
		}
		if (req.application && !tx) {
			meta.app_src = dumpModule(this.pl.session.modules.app);
		}

		if (persist) {
			this.meta.put(meta);
			this.save(MAGIC_MODULES);
		}
		const more = await this.saveState(parentReq ?? req, rest);

		const end = Date.now();
		const time = (end - start) / 1000;

		let event: PengineResponse;
		if (results.length == 0) {
			event = {
				event: "failure",
				id: id,
				time: time,
				output: output,
				meta: meta,
				ask: req.ask,
			};
		} else {
			event = {
				event: "success",
				data: results,
				links: links,
				id: id,
				more: more,
				projection: projection,
				time: time,
				slave_limit: ARBITRARY_HIGH_NUMBER,
				output: output,
				meta: meta,
				ask: req.ask,
			};
		}

		if (!more && req.destroy) {
			event = {
				event: "destroy",
				id: id,
				data: event,
			};
		}

		if (!parentReq && req.create) {
			return {
				event: "create",
				id: id,
				answer: event,
			};
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
		if (request.method != "POST") {
			return new Response("bad method", { status: 405 });
		}

		const url = new URL(request.url);
		const start = Date.now();
		let msg: Partial<PengineRequest>;
		let format = url.searchParams.get("format");
		const create = url.pathname == "/pengine/create";

		const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
		if (contentType.includes("application/json")) {
			msg = await parseAskJSON(this.pl, await request.json());
		} else if (contentType.includes("prolog")) {
			msg = await parseAsk(this.pl, await request.text());
		} else {
			return new Response("Unsupported Media Type", { status: 415 });
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

			const ball = toProlog(err);
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
			const req = await parseAskJSON(this.pl.session, msg.query);
			req.id = id;
			req.format = "json";

			try {
				const result = await this.exec(id, req, Date.now(), true);
				const resp = await formatResponse("json", result, this.pl.session).json();
				const html = await (new HTMLResponse(renderResult(resp as PengineResponse))).text();
				this.broadcast("result:" + html);
			} catch(err) {
				if (err instanceof Error) {
					throw(err);
				}
				const ball = toProlog(err);
				const x = {
					"meta": await this.meta.get(),
					"data": serializeTerm(ball, this.pl),
					"event": "error",
					"id": id,
				};
				console.log("ERR RESP:", ball, x, err);
				const html = await (new HTMLResponse(renderResult(x as PengineResponse))).text();
				this.broadcast("result:" + html);
			}
		}
	}

	async syncApp(app: DurableObjectStub, req: Partial<PengineRequest>, meta: PengineMetadata) {
		console.log("syncing app...", app, req.application, meta);
		const update = new Request(`http://${req.application}/dump.pl`);
		const result = await app.fetch(update);
		const prog = await result.text();
		if (!result.ok) {
			throw makeError("consult_app_error", result.status);
		}
		console.log("app prog for", req.application, "::", prog);
		meta.app_src = prog;
		this.pl.session.consult(prog, {
			session: this.pl.session,
			from: "$pengines-app",
			reconsult: true,
			url: false,
			html: false,
			success: function() {
				console.log("synced w/ app");
			}.bind(this),
			error: function(err: unknown) {
				console.error("invalid app text:", prog);
				throw makeError("consult_error", err, functor("application", req.application));
			}
		});
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

async function parseTerm(sesh: Prolog, raw: string): Promise<pl.type.Value> {
	// const thread = new pl.type.Thread(pl.sesh.session);
	raw = raw.trim();
	if (raw.endsWith(".")) {
		raw = raw.slice(0, -1);
	}
	raw = `ParsedTermXX = (${raw}).`;
	const answers = sesh.query(raw);
	let term;
	for await (const [, answer] of answers) {
		if (answer.indicator == "throw/1") {
			throw answer;
		}
		term = answer.links["ParsedTermXX"];
		break;
	}
	if (!term) {
		throw "couldn't parse raw";
	}
	return term;
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
		switch (lhs.indicator) {
		case "id/1":
			result.id = lhs.args[0].toJavaScript();
			break;
		case "src_text/1":
			result.src_text = lhs.args[0].toJavaScript();
			break;
		case "destroy/1":
			result.destroy = lhs.args[0].toJavaScript() == "true";
			break;
		case "template/1":
			result.template = await parseTerm(sesh, lhs.args[0].body);
			break;
		case "format/1":
			result.format = lhs.args[0].toJavaScript();
			break;
		case "application/1":
			result.application = lhs.args[0].toJavaScript();
			break;
		case "chunk/1":
			result.chunk = lhs.args[0].toJavaScript();
			break;
		case undefined:
			throw "invalid ask:" + ask;
		default:
			console.log("idk:", lhs.indicator);
		}
		arg = arg.args[1] as pl.type.Term<number, string>;
	}

	return result;
}

interface SocketMessage {
	cmd: "hello" | "query",
	query?: PengineRequest
}