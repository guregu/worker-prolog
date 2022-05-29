import { HTMLResponse } from "@worker-tools/html";

import { renderIndex } from "./view";
import { DEFAULT_APPLICATION, PengineRequest, PengineResponse } from "./pengines";

export default {
	async fetch(request: Request, env: any): Promise<Response> {
		const url = new URL(request.url);
		const app = url.searchParams.get("application") || DEFAULT_APPLICATION;
		let idParam = url.searchParams.get("id");
		if (!idParam || idParam.length == 0) {
			idParam = crypto.randomUUID();
			console.log("RANDO", idParam);
		} else {
			console.log("FIXED:", idParam);
		}
		// DO hack?
		url.searchParams.set("pengines_id", idParam);
		// request.url = url.toString();

		const fwd = new Request(url.toString(), {
			method: request.method,
			body: request.body,
			headers: request.headers,
		});

		switch (url.pathname) {
		case "/favicon.ico":
		case "/robots.txt":
			return new Response("no", { status: 404 });
		}

		if (request.method == "OPTIONS") {
			return new Response(null, {headers: corsHeaders});
		}

		// const id = env.PROLOG_DO.idFromName(idParam);
		// const persist = app != DEFAULT_APPLICATION;
		const id = idParam ? env.PROLOG_DO.idFromName(idParam) : env.PROLOG_DO.newUniqueId();
		console.log("ID IDPARAM", id, idParam);
		// const id = persist ? env.PROLOG_DO.newUniqueId() : env.PROLOG_DO.idFromName(app);
		const stub = env.PROLOG_DO.get(id);

		if (url.pathname.startsWith("/pengine/")) {
			return await stub.fetch(fwd);
		}

		const form = url.searchParams;
		console.log("form", form);

		const ask = form.get("ask");
		let result: PengineResponse | undefined;
		if (ask) {
			console.log("asking", id, ask);
			const req: Partial<PengineRequest> = {
				id: idParam ?? undefined,
				ask: ask,
				application: app,
				format: "json",
				src_text: url.searchParams.get("src_text") ?? undefined,
				src_url: url.searchParams.get("src_url") ?? undefined,
			};
			const resp = await stub.fetch(new Request("http://example.com/pengine/create", {
				method: "POST",
				body: JSON.stringify(req),
				headers: {
					"Content-Type": "application/json; charset=UTF-8"
				}
			}));
			result = await resp.json();
		}

		const content = renderIndex(ask, url.searchParams, result);
		return new HTMLResponse(content);
	},
};

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
	"Access-Control-Max-Age": "86400",
	"Allow": "GET, HEAD, POST, OPTIONS",
};

export { PrologDO } from "./pengines";
