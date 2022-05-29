/* eslint-disable no-case-declarations */
import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeList, makeError, functor, toProlog, Query } from "./prolog";
import { replacer, makeReviver, Store } from "./unholy";

export const DEFAULT_APPLICATION = "pengine_sandbox";

const CURRENT_VERSION = 6;
const ARBITRARY_HIGH_NUMBER = 1000000;

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

export interface PengineResponse {
	event: "create" | "destroy" | "success" | "failure" | "error" | "stop",
	id: string,
	data?: PengineResponse | any,
	more?: boolean,
	projection?: string[],
	time?: number, // time taken
	code?: string, // error code
	slave_limit?: number,
	answer?: PengineResponse,
	operators?: Map<number, Map<string, string[]>> // priority (number) → op ("fx" "yfx" etc) → names
}

export interface ErrorEvent extends PengineResponse {
	event: "error",
	data: pl.type.Value,
}

export interface SuccessEvent extends PengineResponse {
	event: "success",
	more: boolean,
	projection: string[],
	time: number,
	data: pl.type.Value[],
	links: pl.type.Substitution[],
	slave_limit?: number,
}

function formatResponse(format: "json" | "prolog", resp: PengineResponse, sesh?: Prolog): Response {
	const json = format == "json";
	const id = new pl.type.Term(resp.id, []);
	const limit = functor("slave_limit", ARBITRARY_HIGH_NUMBER);

	switch (resp.event) {
	case "create":
		if (json) {
			if (resp.answer) {
				resp.answer = makeJSONAnswer(resp.answer, sesh);
			}
			return new JSONResponse(resp);
		}
		if (resp.answer) {
			// TODO: handle better
			return makePrologResponse(makePrologAnswer(resp.answer, true), sesh);
		}
		const term = new pl.type.Term("create", [
			id,
			makeList([limit]),
		]);
		return makePrologResponse(term, sesh);
	case "destroy":
		if (json) {
			if (resp.data) {
				if (resp.data.event == "success") {
					resp.data = makeJSONAnswer(resp.data, sesh);
				} else if (resp.data.event == "failure") {
					// nothin
				} else if (resp.data.event == "error") {
					resp.data = serializeTerm(toProlog(resp.data), sesh);
				}
			}
			return new JSONResponse(resp);
		}

		if (resp.data) {
			switch (resp.data.event) {
			case "success":
				resp.data = makePrologAnswer(resp.data, false);
				break;
			case "failure":
				break;
			case "error":
				resp.data = toProlog(resp.data);
				break;
			}
		}
		return makePrologResponse(new pl.type.Term("destroy", [
			id,
			resp.data ? resp.data : [],
		]), sesh);
		break;
	case "success":
		if (json) {
			return new JSONResponse(makeJSONAnswer(resp, sesh));
		}
		return makePrologResponse(makePrologAnswer(resp, false), sesh);
	case "failure":
		if (json) {
			return new JSONResponse(resp);
		}
		return makePrologResponse(new pl.type.Term("failure", [
			id,
			new pl.type.Num(resp.time, true),
		]), sesh);
	case "error":
		if (json) {
			// TODO: set "code"
			resp.data = serializeTerm(toProlog(resp.data), sesh);
			return new JSONResponse(resp);
		}
		return makePrologResponse(new pl.type.Term("error", [
			id,
			toProlog(resp.data),
		]), sesh);		
	case "stop":
		if (json) {
			return new JSONResponse(resp);
		}	
		return makePrologResponse(new pl.type.Term("stop", [
			id,
			toProlog([]),
		]), sesh);			
	}

	throw `unknown event: ${resp.event}`;
}

function makePrologResponse(term: pl.type.Value, sesh?: Prolog): Response {
	const text = term.toString({
		quoted: true,
		session: sesh?.session,
		ignore_ops: false,
	}, 0);
	return prologResponse(text + ".\n");
}

function makeJSONAnswer(answer: PengineResponse | SuccessEvent, sesh?: Prolog): PengineResponse {
	if (answer.event == "failure") {
		return answer;
	}
	const data = answer.links.map(function (link) {
		const obj: Record<string, string | number | object | null> = {};
		for (const key of Object.keys(link)) {
			obj[key] = serializeTerm(link[key], sesh);
		}
		return obj;
	});
	return {
		"event": "success",
		"data": data,
		"id": answer.id,
		"more": answer.more,
		"projection": answer.projection.map(x => x.toJavaScript()),
		"time": answer.time,
		"slave_limit": ARBITRARY_HIGH_NUMBER,
	};
}

function makePrologAnswer(resp: PengineResponse, sandwich: boolean): pl.type.Term<number, string> {
	/* response format:
		create(
			ID,
			[
				slave_limit(LIMIT),
				answer(
					destroy(ID,
						success(ID,
							RESULTS,
							PROJECTION,
							TIME,
							MORE
						)
					)
				)
			]
		).
	*/
	const idTerm = new pl.type.Term(resp.id, []);

	const success = new pl.type.Term("success", [
		// id
		idTerm,
		// results
		makeList(resp.data),
		// projection
		makeList(resp.projection),
		// time taken
		new pl.type.Num(resp.time, true),
		// more
		new pl.type.Term(String(!!resp.more), []),
	]);

	if (!sandwich) {
		return success;
	}

	return new pl.type.Term("create", [
		// id
		idTerm,
		// data (list)
		new pl.type.Term(".", [
			// limit (required?)
			new pl.type.Term("slave_limit", [new pl.type.Num(ARBITRARY_HIGH_NUMBER, false)]),
			new pl.type.Term(".", [
				// answer
				new pl.type.Term("answer", [
					// data
					new pl.type.Term("destroy", [
						// id
						idTerm,
						// data
						success
					])
				]),
				new pl.type.Term("[]", []),
			]),
		])
	]);
}

export class PrologDO {
	state: DurableObjectState;
	sesh: Prolog;
	src_urls: string[] = [];
	req?: Partial<PengineRequest>;

	points: Store<pl.type.State[]>;
	query: Store<Partial<PengineRequest>>;
	rules: Store<pl.type.Rule[]>;

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
		this.points = new Store(this.state.storage, "points", pl.type);
		this.query = new Store(this.state.storage, "query", pl.type);
		this.rules = new Store(this.state.storage, "rules", pl.type);
		this.state.blockConcurrencyWhile(async () => {
			this.sesh = await this.loadInterpreter(this.state.id.toString());
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
		default:
			console.log("404:", url.pathname);
			return new Response("not found", { status: 404 });
		}
	}

	async loadInterpreter(app: string, module = "user"): Promise<Prolog> {
		const sesh = new Prolog();

		const mod = await this.rules.record(app + "::" + module);
		loadModule(sesh.session.modules[module], mod);

		return sesh;
	}

	async saveInterpreter(app = DEFAULT_APPLICATION, module = "user") {
		const rules: Record<string, pl.type.Rule[]> = this.sesh.session.modules[module]?.rules;
		if (!rules) {
			return false;
		}
		for (const [id, rule] of Object.entries(rules)) {
			const key = `${app}::${module}:${id}`;
			console.log("PUT:", key, rule);
			this.rules.put(key, rule);
		}
		console.log("saved", app, module);
	}

	async loadState(id: string): Promise<[Partial<PengineRequest> | undefined, pl.type.State[]]> {
		const req = await this.query.get(id);
		console.log("reqqq", req);

		const next = await this.points.get(id) ?? [];
		console.log("next?", next);
		return [req, next];
	}

	async saveState(id: string, req: Partial<PengineRequest>, pts: pl.type.State[]) {
		if (pts.length > 0) {
			console.log("SAVING STATE...", id, pts, req);
			this.query.put(id, req);
			this.points.put(id, pts);
			return true; // more
		}
		console.log("DELETING STATE...", id);
		// this.query.delete(id);
		this.points.delete(id);
		return false; // no more
	}

	async exec(id: string, req: Partial<PengineRequest>, start: number, persist: boolean): Promise<PengineResponse> {
		if (req.stop) {
			console.log("TODO: stop", req);	
			if (persist) {
				this.saveInterpreter(id, req.application);
			}
			return {
				event: "stop",
				id: id,
			};
		}
		if (req.destroy) {
			console.log("TODO: destroy", req);
			if (persist) {
				this.saveInterpreter(id, req.application);
			}
			return {
				event: "destroy",
				id: id,
			};
		}
		if (!req.ask && !req.next) {
			// this.req = req;
			if (persist) {
				this.saveInterpreter(id, req.application);
			}
			return {
				event: "create",
				id: id,
				slave_limit: ARBITRARY_HIGH_NUMBER,
			};
		}

		const [parentReq, next] = await this.loadState(id);

		if (req.src_text) {
			// TODO: fancier reconsult
			this.sesh.session.consult(req.src_text, {
				reconsult: true,
				url: false,
				success: function() {
					console.log("consulted text:", req.src_text);
				},
				error: function(err: any) {
					console.error("invalid src_text:", req.src_text);
					throw makeError("consult_error", err, "src_text");
				}
			});
		}

		if (req.src_url) {
			if (!this.src_urls.includes(req.src_url)) {
				const resp = await fetch(new Request(req.src_url));
				if (resp.status != 200) {
					throw makeError("consult_error", functor("bad_status", resp.status), req.src_url);
				}
				const prog = await resp.text();

				console.log("consulted url", req.src_url, prog.slice(0, 64));
				this.sesh.session.consult(prog, {
					reconsult: true,
					url: false,
					success: function() {
						console.log("consulted url:", req.src_url, prog.length);
						this.src_urls.push(req.src_url);
					}.bind(this),
					error: function(err: any) {
						console.error("invalid src_url text:", prog);
						throw makeError("consult_error", err, functor("src_url", req.src_url));
					}
				});
			} else {
				console.log("already loaded:", req.src_url);
			}
		}

		console.log("Ask:", req, "SESH", this.sesh, "NEXT?", next);
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
					"event": "error",
					"id": id,
					"data": answer.args[0],
				};
				return resp;
			}

			if (!queryGoal && answer.links) {
				queryGoal = goal;
				projection = Object.keys(answer.links).map(x => new pl.type.Term(x, []));
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

		if (persist) {
			this.saveInterpreter(req.application, "user");
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

function serializeTerm(term: pl.type.Value, sesh?: Prolog): string | number | object | null {
	if (!term) {
		return null;
	}
	if (pl.type.is_number(term)) {
		return term.value as number;
	}
	if (pl.type.is_atom(term) || pl.type.is_variable(term)) {
		return term.id as string;
	}
	if (pl.type.is_list(term)) {
		let cur: pl.type.Term<number, string> = term;
		const list = [];
		do {
			list.push(serializeTerm(cur.args[0], sesh));
			cur = cur.args[1] as pl.type.Term<number, string>;
		} while (cur.args.length == 2);
		return list;
	}
	if (pl.type.is_js_object(term)) {
		return {
			"functor": "<js>",
			"args": ["object"],
		};
	}
	if (Array.isArray(term?.args)) {
		return {
			"functor": term.id,
			"args": term.args.map(x => serializeTerm(x, sesh)),
			"pretty": term.toString({ session: sesh?.session, quoted: true, squish: true, ignore_ops: false })
		};
	}
	return {
		"functor": "???",
		"args": [serializeTerm(toProlog(term))],
		// "pretty": term.toString({ session: sesh?.session, quoted: true, squish: true, ignore_ops: false })
	};
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


export function prologResponse(text: string): Response {
	console.log("respond:", text);
	return new Response(text, {
		status: 200, headers: {
			"Content-Type": "application/x-prolog; charset=UTF-8"
		}
	});
}
