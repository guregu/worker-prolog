import { HTMLResponse } from "@worker-tools/html";

import { DEFAULT_APPLICATION, PengineMetadata, PengineRequest } from "./pengines";
import { PengineResponse } from "./response";
import { parseResponse } from "./unholy";
import { renderApplication } from "./views/app";
import { renderIndex, renderResult } from "./views/index";
import { renderPengine } from "./views/pengine";

export interface Env {
	PROLOG_DO: DurableObjectNamespace;
	PENGINES_APP_DO: DurableObjectNamespace;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		let idParam = url.searchParams.get("id") ?? undefined;		
		let app = url.searchParams.get("application") || DEFAULT_APPLICATION;

		switch (url.pathname) {
		case "/favicon.ico":
		case "/robots.txt":
			return new Response("no", { status: 404 });
		}

		if (request.method == "OPTIONS") {
			return new Response(null, {headers: corsHeaders});
		}

		const [id, stub] = pengineStub(env, app, idParam)

		// actual pengines API
		if (url.pathname.startsWith("/pengine/") || url.pathname.startsWith("/ws")) {
			// maybe Cloudflare overwrites the "id" param?
			url.searchParams.set("pengines_id", id);
			url.hostname = id;
			const fwd = new Request(url.toString(), {
				method: request.method,
				body: request.body,
				headers: request.headers,
			});
			return stub.fetch(fwd);
		}

		if (url.pathname.startsWith("/sesh/")) {
			idParam = url.pathname.slice("/sesh/".length);
			const bangs = idParam.split("!");
			if (bangs.length == 2) {
				[idParam, app] = bangs;
			}
			const [id, stub] = pengineStub(env, app, idParam)
			return handleWeb(env, request, app, id, stub, false);
		}

		if (url.pathname.startsWith("/app/")) {
			return handleApp(env, request);
		}

		return handleWeb(env, request, app, id, stub, true);
	},
};

async function handleApp(env: Env, request: Request) {
	const url = new URL(request.url);
	const idParam = url.pathname.slice("/app/".length);

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

async function handleWeb(env: Env, request: Request, app: string, id: string, stub: DurableObjectStub, sandbox: boolean) {
	const url = new URL(request.url);
	const form = url.searchParams;

	const ask = form.get("ask") ?? undefined;
	const src_url = form.get("src_url") ?? undefined;
	const src_text = form.get("src_text") ?? undefined;
	let result: PengineResponse | undefined;
	if (ask || src_text || src_url) {
		console.log("asking", id, ask, src_text, src_url);
		const req: Partial<PengineRequest> = {
			id: id,
			ask: ask,
			application: app,
			format: "json",
			src_text: src_text,
			src_url: src_url,
		};
		const resp = await stub.fetch(new Request(`http://${id}/pengine/create`, {
			method: "POST",
			body: JSON.stringify(req),
			headers: {
				"Content-Type": "application/json; charset=UTF-8"
			}
		}));
		result = await resp.json();
	}

	if (form.get("partial") == "result") {
		const content = renderResult(result!);
		return new HTMLResponse(content);	
	}

	const content = renderIndex(sandbox, url.searchParams, result);
	return new HTMLResponse(content);
}

function pengineStub(env: Env, app = DEFAULT_APPLICATION, id = crypto.randomUUID()): [string, DurableObjectStub] {
	const pid = env.PROLOG_DO.idFromName(id);
	return [id, env.PROLOG_DO.get(pid)];
}

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
	"Access-Control-Max-Age": "86400",
	"Allow": "GET, HEAD, POST, OPTIONS",
};

export { PengineDO } from "./pengines";
export { ApplicationDO } from "./application";
