import pl from "tau-prolog";
import { JSONResponse } from "@worker-tools/json-fetch";
import { ARBITRARY_HIGH_NUMBER, PengineMetadata } from "./pengines";
import { functor, makeList, Prolog, toProlog } from "./prolog";

/* eslint-disable no-case-declarations */

export interface PengineResponse {
	event: "create" | "destroy" | "success" | "failure" | "error" | "stop" | "ping",
	id: string,
	data?: PengineResponse | any,
	more?: boolean,
	projection?: string[],
	time?: number, // time taken
	code?: string, // error code
	slave_limit?: number,
	answer?: PengineResponse,

	operators?: Map<number, Map<string, string[]>>, // priority (number) → op ("fx" "yfx" etc) → names (TODO: unused)
	output?: string,
	meta?: PengineMetadata,
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

export function formatResponse(format: "json" | "prolog", resp: PengineResponse, sesh?: Prolog): Response {
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

export function prologResponse(text: string): Response {
	console.log("respond:", text);
	return new Response(text, {
		status: 200, headers: {
			"Content-Type": "application/x-prolog; charset=UTF-8"
		}
	});
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
		event: "success",
		data: data,
		id: answer.id,
		more: answer.more,
		projection: answer.projection.map(x => x.toJavaScript()), // FIXME: hack :-)
		time: answer.time,
		slave_limit: ARBITRARY_HIGH_NUMBER,
		output: answer.output,
		meta: answer.meta,
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
			"pretty": term.toString({ session: sesh?.session, quoted: true, squish: true, ignore_ops: false })
		};
	}
	return {
		"functor": "???",
		"args": [serializeTerm(toProlog(term))],
		// "pretty": term.toString({ session: sesh?.session, quoted: true, squish: true, ignore_ops: false })
	};
}