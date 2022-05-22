import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";

import { Prolog, makeList } from "./prolog";

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
	format: string,
	application: string,
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

	async pengineHandle(request: Request) {
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

		if (!msg.ask) {
			if (format == "prolog") {
				const resp = `create('${id}', []).\n`;
				return prologResponse(resp);
			}
			const resp = {
				event: "create",
				id: id,
			};
			return new JSONResponse(resp);
		}

		if (msg.src_text) {
			sesh.session.consult(msg.src_text, {
				reconsult: true,
				success: function () {
					console.log("consulted text:", msg.src_text);
				},
				error: function (err: any) {
					throw `consult error: ${err}`;
				}
			});
		}

		if (msg.src_url) {
			const resp = await fetch(new Request(msg.src_url));
			if (resp.status != 200) {
				throw "TODO: bad src_url: " + msg.src_url + " ; " + resp.status;
			}
			const prog = await resp.text();

			console.log("consulted url", msg.src_url, prog.slice(0, 64));
			sesh.session.consult(prog, {
				reconsult: true,
				success: function () {
					console.log("consulted text:", msg.src_text);
				},
				error: function (err: any) {
					throw (`consult error: ${err}`);
				}
			});
			// console.log("after consult", msg.src_url, ":\n", sesh.session.modules)
		}

		console.log("Ask:", msg);

		const answers = sesh.query(msg.ask);
		const results = [];
		const links = [];
		let projection: any[] = [];
		let queryGoal: pl.type.Value | undefined;
		for await (const [goal, answer] of answers) {
			const tmpl: pl.type.Value = msg.template ?? goal;

			if (answer.indicator == "throw/1") {
				if (format == "prolog") {
					const idTerm = new pl.type.Term(id, []);
					const ball = answer.args[0];
					const response = new pl.type.Term("create", [
						idTerm,
						new pl.type.Term(".", [
							new pl.type.Term("slave_limit", [new pl.type.Num(ARBITRARY_HIGH_NUMBER, false)]),
							new pl.type.Term(".", [
								new pl.type.Term("answer", [
									new pl.type.Term("destroy", [
										idTerm,
										new pl.type.Term("error", [
											idTerm,
											ball,
										])
									])
								]),
								new pl.type.Term("[]", []),
							]),
						])
					]);
					const text = response.toString(marshalOpts) + ".\n";
					return prologResponse(text);
				}

				const resp = {
					"data": serializeTerm(answer.args[0]),
					"event": "error",
					"id": id
				};
				return new JSONResponse(resp);
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

		if (format == "prolog") {
			const idTerm = new pl.type.Term(id, []);

			if (results.length == 0) {
				// create(ID, [slave_limit(LIMIT), answer(destroy(ID, failure(ID, TIME)))])
				const response = new pl.type.Term("create", [
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
									new pl.type.Term("failure", [
										// id
										idTerm,
										// time taken
										new pl.type.Num(time, true),
									])
								])
							]),
							new pl.type.Term("[]", []),
						]),
					])
				]);
				const text = response.toString(marshalOpts) + ".\n";
				return prologResponse(text);
			}

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
			const response = new pl.type.Term("create", [
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
								new pl.type.Term("success", [
									// id
									idTerm,
									// results
									makeList(results),
									// projection
									makeList(projection),
									// time taken
									new pl.type.Num(time, true),
									// more
									new pl.type.Term("false", []),
								])
							])
						]),
						new pl.type.Term("[]", []),
					]),
				])
			]);
			const text = response.toString(marshalOpts) + ".\n";
			return prologResponse(text);
		}

		if (results.length == 0) {
			const resp = {
				"event": "failure",
				"id": id
			};
			return new Response(JSON.stringify(resp), {
				headers: {
					"Content-Type": "application/json; charset=UTF-8",
				}
			});
		}

		const data = links.map(function (link) {
			const obj: Record<string, string | number | object | null> = {};
			for (const key of Object.keys(link)) {
				obj[key] = serializeTerm(link[key]);
			}
			return obj;
		});
		const resp = {
			"data": data,
			"event": results.length > 0 ? "success" : "failure",
			"id": id,
			"more": false,
			"projection": projection.map(x => x.toJavaScript()),
			"time": time,
			"slave_limit": ARBITRARY_HIGH_NUMBER,
		};
		return new JSONResponse(resp);
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
	for await (const [_, answer] of answers) {
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
