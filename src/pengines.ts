import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeList, makeError, functor, toProlog, Query } from "./prolog";
import { replacer, makeReviver, Store } from "./unholy";
import { ErrorEvent, formatResponse, PengineResponse, prologResponse, serializeTerm } from "./response";
import { Env } from ".";

export const DEFAULT_APPLICATION = "pengine_sandbox";

export const CURRENT_VERSION = 6;
export const ARBITRARY_HIGH_NUMBER = 100;

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
	app_src?: string
}

export class PrologDO {
	state: DurableObjectState;
	env: Env;
	sesh: Prolog;
	consulted_urls: string[] = [];
	req?: Partial<PengineRequest>;

	points: Store<pl.type.State[]>;
	query: Store<Partial<PengineRequest>>;
	rules: Store<pl.type.Rule[]>;
	meta: Store<PengineMetadata>;

	appSocket?: WebSocket;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.points = new Store(this.state.storage, "points", pl.type);
		this.query = new Store(this.state.storage, "query", pl.type);
		this.rules = new Store(this.state.storage, "rules", pl.type);
		this.meta = new Store(this.state.storage, "meta", pl.type);
		this.state.blockConcurrencyWhile(async () => {
			this.sesh = await this.loadInterpreter();
			await this.loadRules();
		});	  
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		console.log("request:", url.pathname);
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

	async handleMeta(request): Promise<Response> {
		const id = this.state.id.toString();
		await this.loadRules();
		const resp = await this.meta.get(id) ?? {};
		return new JSONResponse(resp);
	}

	async loadInterpreter(): Promise<Prolog> {
		const sesh = new Prolog();
		return sesh;
	}

	async loadRules(module = "user"): Promise<PengineMetadata | undefined> {
		const app = this.state.id.toString();
		const mod = await this.rules.record(app, module);
		for (const [pi, rs] of Object.entries(mod)) {
			for (const r of rs) {
				this.sesh.session.add_rule(r, {from: "$storage", context_module: module});
			}
		}
		// loadModule(this.sesh.session.modules[module], mod);

		return this.meta.get(app);
	}

	async saveRules(meta?: PengineMetadata, module = "user") {
		const app = this.state.id.toString();
		if (meta) {
			this.meta.put(app, meta);
		}
		const rules: Record<string, pl.type.Rule[]> = this.sesh.session.modules[module]?.rules;
		if (rules) {
			for (const [pi, rule] of Object.entries(rules)) {
				console.log("SRC_PRED", pi, rule, this.sesh.session.modules[module].src_predicates[pi]);
				this.rules.putRecordItem(app, module, pi, rule);
				// this.rules.putRecord(app, module, rules);
			}
		}

		console.log("saved", app, module);
	}

	async loadState(id: string): Promise<[Partial<PengineRequest> | undefined, pl.type.State[]]> {
		const req = await this.query.get(id);
		const next = await this.points.get(id) ?? [];
		return [req, next];
	}

	async saveState(id: string, req: Partial<PengineRequest>, pts: pl.type.State[]) {
		if (pts.length > 0) {
			this.query.put(id, req);
			this.points.put(id, pts);
			return true; // more
		}
		this.points.delete(id);
		return false; // no more
	}

	async exec(id: string, req: Partial<PengineRequest>, start: number, persist: boolean): Promise<PengineResponse> {
		const meta: PengineMetadata = (await this.loadRules()) ?? {src_urls: [], title: "prolog~"};
		const [parentReq, next] = await this.loadState(id);

		console.log("##############", meta, parentReq, next);

		if (req.stop) {
			console.log("TODO: stop", req);	
			if (persist) {
				this.saveRules();
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
				this.saveRules();
			}
			return {
				event: "destroy",
				id: id,
				meta: meta,
			};
		}

		if (req.application) {
			meta.application = req.application;
			const app = this.env.PENGINES_APP_DO.get(
				this.env.PENGINES_APP_DO.idFromName(req.application));

			console.log("RDY?", this.appSocket, this.appSocket?.readyState);

			if (!this.appSocket || this.appSocket.readyState !== this.appSocket.OPEN) {
				const resp = await app.fetch(`http://${req.application}`, {
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
				console.log("contexted", ws);

				// Now you can send and receive messages like before.
				ws.send("hello");
				ws.addEventListener("message", msg => {
					console.log("GOTMSG", msg);
				});
			}	

			const update = new Request(`http://${req.application}/dump.pl`);
			const result = await app.fetch(update);
			const prog = await result.text();
			if (!result.ok) {
				throw makeError("consult_app_error", result.status);
			}
			meta.app_src = prog;
			this.sesh.session.modules.app = new pl.type.Module("app", {}, "all", {
				session: this.sesh.session,
				dependencies: ["system"]
			});
			this.sesh.session.consult(prog, {
				from: "$pengines-app",
				context_module: "app",
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					console.log("synced w/ app");
				}.bind(this),
				error: function(err) {
					console.error("invalid app text:", prog);
					throw makeError("consult_error", err, functor("application", req.application));
				}
			});
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
				this.sesh.session.consult(prog, {
					from: url,
					reconsult: true,
					url: false,
					html: false,
					success: function() {
						console.log("consulted url:", url, prog.length);
						this.consulted_urls.push(url);
					}.bind(this),
					error: function(err: any) {
						console.error("invalid src_url text:", prog);
						throw makeError("consult_error", err, functor("src_url", url));
					}
				});
			} else {
				console.log("already loaded:", url);
			}
		}

		if (req.src_text) {
			this.sesh.session.consult(req.src_text, {
				from: "$src_text",
				reconsult: true,
				url: false,
				html: false,
				success: function() {
					meta.src_text = req.src_text;
					console.log("consulted text:", req.src_text);
				},
				error: function(err: any) {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		if (!req.ask && !req.next) {
			if (persist) {
				this.saveRules(meta);
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
			query = new Query(this.sesh.session, req.ask);
		} else {
			query = new Query(this.sesh.session, next);
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
				console.log("chunkin'", req.chunk, rest, "SESH", this.sesh);
				break;
			}
		}
		rest = query.thread.points;
		const output = query.output();

		const tx = query.tx();
		if (tx) {
			const appTx = [];
			for (const op of tx) {
				if (op.args[0]?.indicator == ":/2" && op.args[0]?.args[0] == "app") {
					appTx.push(op);
				}
			}
			if (req.application && appTx.length > 0) {
				const txQuery = tx.map(t => t.toString({session: this.sesh.session, quoted: true, ignore_ops: true})).join(", ") + ".";
				console.log("TX query:", txQuery);
				const app = this.env.PENGINES_APP_DO.get(
					this.env.PENGINES_APP_DO.idFromName(req.application));
				const update = new Request(`http://${req.application}/exec`, {
					method: "POST",
					body: txQuery,
				});
				const result = await app.fetch(update);
				if (!result.ok) {
					throw("TX FAILED");
				}
				meta.app_src = await result.text();	
			}
		}

		if (persist) {
			this.saveRules(meta);
		}
		const more = await this.saveState(id, parentReq ?? req, rest);

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
			msg = await parseAskJSON(this.sesh, await request.json());
		} else if (contentType.includes("prolog")) {
			msg = await parseAsk(this.sesh, await request.text());
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
			return formatResponse(format, resp, this.sesh);
		} catch(err) {
			if (err instanceof Error) {
				throw(err);
			}

			const ball = toProlog(err);
			if (format == "json") {
				const resp = {
					"data": serializeTerm(ball, this.sesh),
					"event": "error",
					"id": id,
				};
				return new JSONResponse(resp);
			}
			const idTerm = new pl.type.Term(id, []);
			const msg = new pl.type.Term("error", [idTerm, ball]);
			const text = msg.toString({session: this.sesh.session, quoted: true, ignore_ops: false }) + ".\n";
			return prologResponse(text);
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

function loadModule(mod: any, data: any) {
	console.log("LOADIN!", data);
	// TODO Use session.add_rule instead

	for (const id of Object.keys(data)) {
		mod.rules[id] = [];
	}
	
	for (const id of Object.keys(data)) {
		const rules = data[id];
		for (const rule of rules) {
			if (mod.rules[id] === undefined) {
				mod.rules[id] = [];
			}
			mod.public_predicates[id] = true;
			mod.rules[id].push(rule);
			mod.update_indices_predicate(id);
		}
	}
}
