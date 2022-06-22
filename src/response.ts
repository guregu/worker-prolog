import pl, { ErrorInfo } from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";
import { ARBITRARY_HIGH_NUMBER, Format, PengineMetadata, PengineReply } from "./pengines";
import { functor, makeList, Prolog, toProlog } from "./prolog";

/* eslint-disable no-case-declarations */

export interface PengineResponse {
	// actual Pengines API
	event: "create" | "destroy" | "success" | "failure" | "error" | "stop" | "ping",
	id: string,
	data?: PengineResponse | any,
	more?: boolean,
	projection?: string[],
	time?: number, // time taken
	code?: string, // error code
	slave_limit?: number,
	answer?: PengineResponse,

	// extras
	ask?: string,
	error?: ErrorInfo,
	operators?: Map<number, Map<string, string[]>>, // priority (number) → op ("fx" "yfx" etc) → names (TODO: unused)
	output?: string,
	meta?: PengineMetadata,
	debug?: {
		dump?: Record<string, string>,
	},
	rights?: {
		edit: boolean,
	},
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

function formatJSON(reply: PengineReply, prolog?: Prolog): Response {
	let wrap: (x: PengineResponse) => typeof x;
	switch (reply.lifecycle) {
	case "full":
		// TODO: double-check this
		wrap = (x) => {
			return {
				event: "create",
				id: reply.id,
				answer: x,
				data: {
					event: "destroy",
					id: reply.id,
				},
				meta: reply.meta,
			};
		};
		break;
	case "create":
		wrap = (x) => {
			return {
				event: "create",
				id: reply.id,
				answer: x,
				meta: reply.meta,
			};
		};
		break;
	case "destroy":
		wrap = (x) => {
			return {
				event: "destroy",
				id: reply.id,
				data: x,
				meta: reply.meta,
			};
		};
		break;
	default:
		wrap = x => x;
		break;
	}

	switch (reply.event) {
	case "create":
		return new JSONResponse({
			event: "create",
			id: reply.id,
			meta: reply.meta,
			debug: reply.debug,
			slave_limit: reply.slave_limit,
		});
	case "destroy":
		return new JSONResponse({
			event: "destroy",
			id: reply.id,
			meta: reply.meta,
			debug: reply.debug,
			slave_limit: reply.slave_limit,
		});

	case "success":
		return new JSONResponse(wrap(makeJSONAnswer(reply, prolog)));
	case "failure":
		return new JSONResponse(wrap({
			event: "failure",
			id: reply.id,
			ask: reply.ask,
			time: reply.time,
			output: reply.output,
			meta: reply.meta,
			debug: reply.debug,
		}));
	case "error":
		const term = toProlog(reply.error);
		let error;
		if (pl.type.is_error(term)) {
			error = pl.flatten_error(term);
		}
		return new JSONResponse(wrap({
			event: "error",
			id: reply.id,
			data: serializeTerm(term),
			time: reply.time,
			slave_limit: ARBITRARY_HIGH_NUMBER,
			output: reply.output,
			meta: reply.meta,
			ask: reply.ask,
			debug: reply.debug,
			error: error,
		}))

	case "stop":
		return new JSONResponse(wrap({
			event: "stop",
			id: reply.id,
			meta: reply.meta,
			debug: reply.debug,
			slave_limit: reply.slave_limit,
		}));
	// case "ping":
	// 	return new JSONResponse(wrap({
	// 		event: "ping",
	// 		id: reply.id,
	// 		meta: reply.meta,
	// 		debug: reply.debug,
	// 		slave_limit: reply.slave_limit,
	// 	}));
	}
	throw `unhandled event: ${reply.event} ${reply}`;
}

function formatProlog(reply: PengineReply, prolog?: Prolog): Response {
	const id = new pl.type.Term(reply.id, []);
	const limit = functor("slave_limit", ARBITRARY_HIGH_NUMBER);

	let wrap: (x: pl.type.Term<number, string>) => typeof x;
	switch (reply.lifecycle) {
	case "full":
		wrap = (x: pl.type.Term<number, string>) => {
			return new pl.type.Term("create", [
				// id
				id,
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
								id,
								// data
								x
							])
						]),
						new pl.type.Term("[]", []),
					]),
				])
			]);
		}
		break;
	case "create":
		wrap = (x: pl.type.Term<number, string>) => {
			return new pl.type.Term("create", [
				// id
				id,
				// data (list)
				new pl.type.Term(".", [
					// limit (required?)
					new pl.type.Term("slave_limit", [new pl.type.Num(ARBITRARY_HIGH_NUMBER, false)]),
					new pl.type.Term(".", [
						// answer
						new pl.type.Term("answer", [
							x,
						]),
						new pl.type.Term("[]", []),
					]),
				])
			]);
		}
		break;
	case "destroy":
		wrap = (x: pl.type.Term<number, string>) => {
			return new pl.type.Term("create", [
				// id
				id,
				// data (list)
				new pl.type.Term(".", [
					// limit (required?)
					new pl.type.Term("slave_limit", [new pl.type.Num(ARBITRARY_HIGH_NUMBER, false)]),
					new pl.type.Term(".", [
						// answer
						new pl.type.Term("answer", [
							x,
						]),
						new pl.type.Term("[]", []),
					]),
				])
			]);
		}
		break;
	default:
		wrap = x => x;
	}

	switch (reply.event) {
	case "ping":
		// TODO: double-check, same as create?
	case "create":
		const term = new pl.type.Term("create", [
			id,
			makeList([limit]),
		]);
		return makePrologResponse(term, prolog);
	case "destroy":
		return makePrologResponse(new pl.type.Term("destroy", [
			id,
			makeList(),
		]), prolog);
	case "success":
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
		const success = new pl.type.Term("success", [
			// id
			id,
			// results
			makeList(reply.results),
			// projection
			makeList(reply.projection),
			// time taken
			new pl.type.Num(reply.time ?? 0, true),
			// more
			new pl.type.Term(String(!!reply.more), []),
		]);
		return makePrologResponse(wrap(success));
	case "failure":
		return makePrologResponse(wrap(
			new pl.type.Term("failure", [
				id,
				new pl.type.Num(reply.time ?? 0, true),
			]
		)));
	case "error":
		// TODO: iirc no wrapping here?
		return makePrologResponse(new pl.type.Term("error", [
			id,
			toProlog(reply.error),
		]), prolog);		
	case "stop":
		// TODO: wrap or not?
		return makePrologResponse(new pl.type.Term("stop", [
			id,
			toProlog([]),
		]), prolog);
	}

	throw `unknown event: ${reply.event}`;
}

export function formatResponse(format: Format, reply: PengineReply, prolog?: Prolog): Response {
	switch (format) {
	case "prolog":
		return formatProlog(reply, prolog);
	case "json":
		return formatJSON(reply, prolog);
	case "raw":
		const out = reply.output ?? "";
		return new Response(out, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8"
			}
		});
	case "json_atom":
		if (reply.event == "error") {
			return formatResponse("json", reply, prolog);
			// reply.data = serializeTerm(toProlog(reply.data), sesh);
			// return new JSONResponse(reply);
		}
		if (reply.event == "failure") {
			return new JSONResponse({});
		}
		
		const varname = "JSON";
		// TODO json-seq?

		if (!Array.isArray(reply.links)) {
			throw `missing links: ${reply}`;
		}

		for (const link of reply.links) {
			const atom = link.links[varname];
			if (!pl.type.is_atom(atom)) {
				return new JSONResponse({error: "unknown variable: " + varname}, {
					status: 400,
				});
			}
			try {
				const x = JSON.parse(atom.id);
				return new JSONResponse(x);
			} catch {
				return new JSONResponse({error: "malformed JSON: " + varname, text: atom.id}, {
					status: 400,
				});
			}
		}
		return new JSONResponse({error: "no answer: " + varname}, {
			status: 400,
		});
	}

	throw `unknown event: ${reply.event}`;
}

function makePrologResponse(term: pl.type.Value, sesh?: Prolog): Response {
	const text = term.toString({
		quoted: true,
		session: sesh?.session,
		ignore_ops: false,
	}, 0);
	return prologResponse(text + ".\n");
}

export function prologResponse(text: string): Response {
	// console.log("respond:", text);
	return new Response(text, {
		status: 200, headers: {
			"Content-Type": "application/x-prolog; charset=UTF-8"
		}
	});
}

function makeJSONAnswer(answer: PengineReply, sesh?: Prolog): PengineResponse {
	if (answer.event == "failure") {
		return {
			event: "failure",
			id: answer.id,
			time: answer.time,
			slave_limit: ARBITRARY_HIGH_NUMBER,
			output: answer.output,
			meta: answer.meta,
			ask: answer.ask,
			debug: answer.debug,
		}
	}
	const data = answer.links!.map(function (link) {
		const obj: Record<string, string | number | object | null> = {};
		for (const key of Object.keys(link.links)) {
			obj[key] = serializeTerm(link.links[key], sesh);
		}
		return obj;
	});
	return {
		event: "success",
		data: data,
		id: answer.id,
		more: answer.more,
		projection: answer.projection?.map(x => x.toJavaScript()) as string[],
		time: answer.time,
		slave_limit: ARBITRARY_HIGH_NUMBER,
		output: answer.output,
		meta: answer.meta,
		ask: answer.ask,
		debug: answer.debug,
	};
}

export function serializeTerm(term: pl.type.Value, sesh?: Prolog): string | number | object | null {
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
			"pretty": term.toString({ session: sesh?.session, quoted: true, ignore_ops: false })
		};
	}
	return {
		"functor": "???",
		"args": [serializeTerm(toProlog(term))],
		// "pretty": term.toString({ session: sesh?.session, quoted: true, squish: true, ignore_ops: false })
	};
}