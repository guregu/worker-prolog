import { HTMLResponse } from "@worker-tools/html";

import { DEFAULT_APPLICATION, PengineRequest } from "./pengines";
import { PengineResponse } from "./response";
import { renderIndex } from "./views/index";
import { renderPengine } from "./views/pengine";

export default {
	async fetch(request: Request, env: any): Promise<Response> {
		const url = new URL(request.url);
		const app = url.searchParams.get("application") || DEFAULT_APPLICATION;
		let idParam = url.searchParams.get("id");
		if (!idParam || idParam.length == 0) {
			idParam = crypto.randomUUID();
		}
		// DO hack?
		url.searchParams.set("pengines_id", idParam);
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

		// const persist = app != DEFAULT_APPLICATION;
		const id = env.PROLOG_DO.idFromName(idParam);
		const stub = env.PROLOG_DO.get(id);

		if (url.pathname.startsWith("/pengine/")) {
			return await stub.fetch(fwd);
		}

		if (url.pathname.startsWith("/p/")) {
			const resp = await stub.fetch(new Request(url.toString(), {
				// method: "POST",
				// body: JSON.stringify(req),
				// headers: {
				// 	"Content-Type": "application/json; charset=UTF-8"
				// }
			}));
			const result = await resp.json();
			const content = renderPengine(result);
			return new HTMLResponse(content);
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
