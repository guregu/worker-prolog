/* eslint-disable no-case-declarations */
import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeList, makeError, functor, toProlog } from "./prolog";

export const DEFAULT_APPLICATION = "pengine_sandbox";

const CURRENT_VERSION = 6;
const ARBITRARY_HIGH_NUMBER = 1000000;

export interface PengineRequest {
	ask: string,
	src_text: string,
	src_url: string,
	destroy: boolean,
	stop: boolean,
	template: pl.type.Value,
	format: "json" | "prolog",
	application: string,
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
				resp.answer = makeJSONAnswer(resp.answer);
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
		// TODO
		break;
	case "success":
		if (json) {
			return new JSONResponse(makeJSONAnswer(resp));
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
			resp.data = serializeTerm(toProlog(resp.data));
			return new JSONResponse(resp);
		}
		return makePrologResponse(new pl.type.Term("error", [
			id,
			toProlog(resp.data),
		]), sesh);						
	}

	throw `unknown event: ${resp.event}`;
}

function makePrologResponse(term: pl.type.Value, sesh?: Prolog): Response {
	const text = term.toString({
		quoted: true,
		session: sesh?.session,
		ignore_ops: false,
	});
	return prologResponse(text + ".\n");
}

function makeJSONAnswer(answer: SuccessEvent): PengineResponse {
	const data = answer.links.map(function (link) {
		const obj: Record<string, string | number | object | null> = {};
		for (const key of Object.keys(link)) {
			obj[key] = serializeTerm(link[key]);
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
		new pl.type.Term("false", []),
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
	state: any;

	constructor(state: any, env: any) {
		this.state = state;
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

	async loadInterpreter(app = DEFAULT_APPLICATION, module = "user"): Promise<Prolog> {
		const root = `app:${app}:v${CURRENT_VERSION}:module:${module}:`;
		const sesh = new Prolog();

		const rules: Map<string, any> = await this.state.storage.list({
			prefix: root,
		});

		const mod = {};
		let n = 0;
		for (const [key, rule] of rules) {
			const id = key.slice(root.length);
			mod[id] = rule;
			n++;
		}

		// const mod = await this.state.storage.get(key);
		if (n > 0) {
			loadModule(sesh.session.modules[module], mod);
		} else {
			console.log("mod not found:", root);
		}
		return sesh;
	}

	async saveInterpreter(sesh: Prolog, app = DEFAULT_APPLICATION, module = "user") {
		const root = `app:${app}:v${CURRENT_VERSION}:module:${module}:`;
		for (const [id, rule] of Object.entries(sesh.session.modules[module].rules)) {
			const key = root + id;
			console.log("PUT:", key, rule);
			this.state.storage.put(key, rule);
		}
	}

	async exec(id: string, sesh: Prolog, req: Partial<PengineRequest>, start: number, persist: boolean): Promise<PengineResponse> {
		if (!req.ask) {
			return {
				event: "create",
				id: id,
			};
		}

		if (req.src_text) {
			// TODO: fancier reconsult
			sesh.session.consult(req.src_text, {
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
			const resp = await fetch(new Request(req.src_url));
			if (resp.status != 200) {
				throw makeError("consult_error", functor("bad_status", resp.status), req.src_url);
			}
			const prog = await resp.text();

			console.log("consulted url", req.src_url, prog.slice(0, 64));
			sesh.session.consult(prog, {
				reconsult: true,
				url: false,
				success: function() {
					console.log("consulted url:", req.src_url, prog.length);
				},
				error: function(err: any) {
					console.error("invalid src_url text:", prog);
					throw makeError("consult_error", err, functor("src_url", req.src_url));
				}
			});
		}

		console.log("Ask:", req);

		const answers = sesh.query(req.ask);
		const results = [];
		const links = [];
		let projection: any[] = [];
		let queryGoal: pl.type.Value | undefined;
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
		}

		if (persist) {
			this.saveInterpreter(sesh);
		}

		const end = Date.now();
		const time = (end - start) / 1000;

		if (results.length == 0) {
			return {
				event: "failure",
				id: id,
				time: time,
			};
		}

		const resp: SuccessEvent = {
			event: "success",
			data: results,
			links: links,
			id: id,
			more: false,
			projection: projection,
			time: time,
			slave_limit: ARBITRARY_HIGH_NUMBER,
		};
		return resp;
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
		const sesh = await this.loadInterpreter();
		const persist = false;
		const marshalOpts = { session: sesh.session, quoted: true, ignore_ops: false };

		// let format, ask, template, application, src_text, src_url;
		let msg: Partial<PengineRequest>;
		let format = url.searchParams.get("format");

		const contentType = request.headers.get("Content-Type")?.toLowerCase() || "";
		if (contentType.includes("application/json")) {
			msg = await parseAskJSON(sesh, await request.json());
		} else if (contentType.includes("prolog")) {
			msg = await parseAsk(sesh, await request.text());
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

		const id = msg.application;

		try {
			const resp = await this.exec(id, sesh, msg, start, persist);
			return formatResponse(format, resp, sesh);
		} catch(err) {
			const ball = toProlog(err);
			if (format == "json") {
				const resp = {
					"data": serializeTerm(ball),
					"event": "error",
					"id": id,
				};
				return new JSONResponse(resp);
			}
			const idTerm = new pl.type.Term(id, []);
			const msg = new pl.type.Term("error", [idTerm, ball]);
			const text = msg.toString({session: sesh.session, quoted: true, ignore_ops: false }) + ".\n";
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
	if (term == null) {
		throw "null term";
	}
	return new pl.type.Term(term.id, term.args?.map(unserializeTerm));
}

function unserializeRule(rule: any): pl.type.Rule {
	return new pl.type.Rule(unserializeTerm(rule.head), unserializeTerm(rule.body), rule.dynamic);
}

function serializeTerm(term: pl.type.Value): string | number | object | null {
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
			list.push(serializeTerm(cur.args[0]));
			cur = cur.args[1] as pl.type.Term<number, string>;
		} while (cur.args.length == 2);
		return list;
	}
	return {
		"functor": term.id,
		"args": term.args.map(x => serializeTerm(x))
	};
}

async function parseAskJSON(sesh: Prolog, obj: any): Promise<Partial<PengineRequest>> {
	const req: Partial<PengineRequest> = {
		ask: fixQuery(obj.ask),
		src_text: obj.src_text,
		src_url: obj.src_url,
		format: obj.format,
		application: obj.application || DEFAULT_APPLICATION,
	};
	if (obj.template) {
		req.template = await parseTerm(sesh, obj.template);
	}
	return req;
}

async function parseTerm(sesh: Prolog, raw: string): Promise<pl.type.Value> {
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
