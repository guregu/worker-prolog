import { HTMLResponse } from "@worker-tools/html";

import { renderIndex } from "./view";
import { DEFAULT_APPLICATION, PengineRequest } from "./pengines";

export default {
	async fetch(request: Request, env: any): Promise<Response> {
		const url = new URL(request.url);
		const app = url.searchParams.get("application") || DEFAULT_APPLICATION;

		switch (url.pathname) {
		case "/favicon.ico":
		case "/robots.txt":
			return new Response("no", { status: 404 });
		}

		if (request.method == "OPTIONS") {
			return new Response(null, {headers: corsHeaders});
		}

		const id = env.PROLOG_DO.idFromName("test_" + app);
		const stub = env.PROLOG_DO.get(id);

		if (url.pathname.startsWith("/pengine/")) {
			return await stub.fetch(request);
		}

		const form = url.searchParams;
		console.log("form", form);

		const ask = form.get("ask");
		let result: any;
		if (ask) {
			const req: Partial<PengineRequest> = {
				ask: ask,
				format: "json",
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

		const content = renderIndex(ask, result);
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
