import { HTMLResponse } from "@worker-tools/html";

import { DEFAULT_APPLICATION, PengineRequest } from "./pengines";
import { PengineResponse } from "./response";
import { parseRequest, parseResponse } from "./unholy";
import { renderApplication } from "./views/app";
import { renderIndex } from "./views/index";
import { renderPengine } from "./views/pengine";

export interface Env {
	PROLOG_DO: DurableObjectNamespace;
	PENGINES_APP_DO: DurableObjectNamespace;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
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
			// const id = url.pathname.slice("/p/".length);
			const resp = await stub.fetch(new Request("https://example.com/meta", {
				// method: "POST",
				// body: JSON.stringify(req),
				// headers: {
				// 	"Content-Type": "application/json; charset=UTF-8"
				// }
			}));
			const result = await resp.json();
			console.log("RESULT", result);
			const content = renderPengine(result, url.searchParams);
			return new HTMLResponse(content);
		}

		if (url.pathname.startsWith("/app/")) {
			const appID = env.PENGINES_APP_DO.idFromName(idParam);
			const appDO = env.PENGINES_APP_DO.get(appID);

			url.searchParams.set("application", idParam);
			url.pathname = request.method == "POST" ? "/set" : "/";
			const href = url.toString();

			let resp: Response;
			if (request.method == "POST") {
				const formData = await request.formData();
				const body = {
					src_text: formData.get("src_text"),
					title: formData.get("title"),
					src_urls: [],
				};
				const json = JSON.stringify(body);
				resp = await appDO.fetch(new Request(href, {
					method: "POST",
					body: json,
				}));
			} else {
				resp = await appDO.fetch(new Request(href));
			}
			const result = await parseResponse(resp);
			console.log("RESULT", result);
			const content = renderApplication(result, url.searchParams);
			return new HTMLResponse(content);
		}

		const form = url.searchParams;
		console.log("form", form);

		const ask = form.get("ask");
		const src_url = form.get("src_url");
		const src_text = form.get("src_text");
		let result: PengineResponse | undefined;
		if (ask || src_text || src_url) {
			console.log("asking", id, ask, src_text, src_url);
			const req: Partial<PengineRequest> = {
				id: idParam ?? undefined,
				ask: ask,
				application: app,
				format: "json",
				src_text: src_text ?? undefined,
				src_url: src_url ?? undefined,
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
export { ApplicationDO } from "./application";
