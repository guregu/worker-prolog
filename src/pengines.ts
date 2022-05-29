/* eslint-disable no-case-declarations */
import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeList, makeError, functor, toProlog, Query } from "./prolog";

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
	destroy: boolean,
	stop: boolean,
	next: boolean,
}

export interface PengineResponse {
	event: "create" | "destroy" | "success" | "failure" | "error",
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

	constructor(state: DurableObjectState, env: any) {
		this.state = state;
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
		const root = `app:${app}:v${CURRENT_VERSION}:module:${module}:`;
		const sesh = new Prolog();

		const rules: Map<string, any> = await this.state.storage.list({
			prefix: root,
		});

		const mod = {};
		let n = 0;
		for (const [key, rule] of rules) {
			const pi = key.slice(root.length);
			mod[pi] = rule;
			n++;
		}

		if (n > 0) {
			loadModule(sesh.session.modules[module], mod);
		} else {
			console.log("mod not found:", root);
		}

		return sesh;
	}

	async saveInterpreter(app = DEFAULT_APPLICATION, module = "user") {
		// const root = `app:${app}:v${CURRENT_VERSION}:module:${module}:`;
		const id = this.state.id.toString(); // TODO
		const root = `app:${id}:v${CURRENT_VERSION}:module:${module}:`;
		const rules = this.sesh.session.modules[module]?.rules;
		if (!rules) {
			return false;
		}
		for (const [id, rule] of Object.entries(rules)) {
			const key = root + id;
			console.log("PUT:", key, rule);
			this.state.storage.put(key, rule);
		}
		console.log("saved", app, module);
	}

	async loadState(id: string): Promise<[Partial<PengineRequest>, pl.type.State[]]> {
		const reqKey = `id:${id}:v${CURRENT_VERSION}:req`;
		const req = await this.state.storage.get(reqKey) as Partial<PengineRequest>;
		console.log("reqqq", req);

		let next = [];
		const ptsKey = `id:${id}:v${CURRENT_VERSION}:points`;
		const pts = await this.state.storage.get(ptsKey);
		console.log("K,V", ptsKey, pts);
		if (pts) {
			next = await this.loadChoicePoints(pts);
			console.log("ptzaft22222er", next);
			// next = this.next;
		}
		return [req, next];
	}

	async saveState(id: string, req: Partial<PengineRequest>, pts: pl.type.State[]) {
		console.log("SAVE STATE:", id, req, pts);

		const reqKey = `id:${id}:v${CURRENT_VERSION}:req`;
		const ptsKey = `id:${id}:v${CURRENT_VERSION}:points`;

		if (pts.length > 0) {
			console.log("SAVING STATE...", id, req, pts, "||", ptsKey, pts);
			// TODO maybe unneeded
			await this.state.storage.put(reqKey, req);
			await this.state.storage.put(ptsKey, pts);
			// more
			return true;
		}

		console.log("DELETING!! STATE...", id, req, pts);
		this.state.storage.delete(reqKey);
		this.state.storage.delete(ptsKey);
		// no more
		return false;
	}

	async loadChoicePoints(pts: pl.type.State[]) {
		console.log("---------> from", pts);
		const next = [];
		const proto = Object.getPrototypeOf(new pl.type.State());
		for (let pt of pts) {
			pt = Object.setPrototypeOf(pt, proto);
			let current = pt;
			while (current) {
				console.log("enloop p");
				current = Object.setPrototypeOf(current, proto);
				if (current.goal) {
					current.goal = unserializeTerm(current.goal);
				}
				if (current.substitution) {
					const links = {};
					// TODO: attrs
					for (const [k, v] of Object.entries(current.substitution.links)) {
						links[k] = unserializeValue(v);
					}
					current.substitution = new pl.type.Substitution(links);
				}
				current = current.parent;
			}
			console.log("outloop p");
			console.log("PUSHIN'!", pt);
			next.push(pt.clone());
			console.log("afterxxPUSHIN'!", next.length);
			// return [pt];
			// const clone = pt.clone(); // TODO: needed?
			// this.next.push(clone);
		}
		console.log("retrnin", next);
		return next;
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
			};
		}

		const [parentReq, next] = await this.loadState(id);
		console.log("LOADED STATE:", id, parentReq, next);

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

		if (req.next) {
			console.log("REQ NEXT:", this.req, next);
			// req.ask = undefined;
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

		// if (!more && req.destroy) {
		// 	event = {
		// 		event: "destroy",
		// 		id: id,
		// 		data: event,
		// 	};
		// }

		if (!parentReq) {
			return {
				event: "create",
				id: id,
				answer: event,
			};
		}

		if (more) {
			return event;
		}
	
		return {
			event: "destroy",
			id: id,
			data: event,
		};
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

		if (!msg.application) {
			msg.application = DEFAULT_APPLICATION;
		}

		const id = url.searchParams.get("pengines_id") ?? msg.id ?? this.state.id.toString();
		console.log("ID===", url.searchParams.get("id"), msg.id, "XXX");
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

function unserializeTerm(term: any): pl.type.Term<number, string> {
	if (term == undefined) {
		console.log("undefined term");
		return undefined;
	}
	return new pl.type.Term(term.id, term.args?.map(unserializeValue));
}

function unserializeRule(rule: any): pl.type.Rule {
	return new pl.type.Rule(unserializeTerm(rule.head), unserializeTerm(rule.body), rule.dynamic);
}

function unserializeValue(v: any): pl.type.Value {
	if (v == undefined) {
		console.log("undefined value");
		return undefined;
	}
	if (typeof v.is_float == "boolean") {
		return new pl.type.Num(v.value, v.is_float);
	}
	if (typeof v.ground == "boolean") {
		return new pl.type.Var(v.id, v.ground);
	}
	return unserializeTerm(v);
}

function unserializeState(state: any): pl.type.State {
	throw(state);
	// return new pl.type.State();
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
		console.log("serualizin", term);
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
		for (const raw of rules) {
			const rule = unserializeRule(raw);
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
