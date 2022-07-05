import { html, HTML, unsafeHTML } from "@worker-tools/html";
import { PengineResponse, QueryInfo } from "../response";
import { renderDescription, renderQuery, renderResult } from "./result";
import { socketJS, texteditJS } from "./scripts";
import { favicon, indexStyle } from "./style";

import _fizzbuzz from "./examples/fizzbuzz.pl";
import { terminalJS } from "./terminal";

const EXAMPLE_QUERIES: [string, string][] = [
	["", "permutation(\"dog\", Word)."],
	["% https://en.wikipedia.org/wiki/Syllogism\n\nhuman(socrates).\nmortal(X) :- human(X).", "mortal(X)."],
	[_fizzbuzz, "fizzbuzz(1, 15)."],
	["", "between(1, 32, N), Square is N^2, Cube is N^3."],
	["% http://www.tau-prolog.org/documentation#js\n% https://github.com/tau-prolog/tau-prolog/issues/299\n:- use_module(library(js)).\n", "json_prolog(_JS, [a, [x-[yes-{true}, no-{false}, '$1b mistake'-{null}]], [hello-prolog, born-1972]]), json_atom(_JS, JSON)."],
	["% https://www.j-paine.org/dobbs/prolog_lightbulb.html\n\nchange_lightbulb(1, porlog_programmer).", "change_lightbulb(HowMany, prolog_programmer)."],
];

export function renderIndex(sandbox: boolean, params: URLSearchParams, result?: PengineResponse, isIndex?: boolean) {
	const meta = result?.meta ?? result?.answer?.meta ?? result?.data?.meta;
	const src_text = result?.meta?.src_text ?? result?.answer?.meta?.src_text ?? result?.data?.meta?.src_text;
	const application = result?.meta?.application ?? result?.answer?.meta?.application ?? result?.data?.meta?.application;
	const debug = result?.debug ?? result?.answer?.debug ?? result?.data?.debug;
	const query = result?.query ?? result?.answer?.query ?? result?.data?.query;
	const jobs = !!query; // TODO: ?
	const id = result?.id || crypto.randomUUID();
	if (result?.event == "create" && result?.answer) {
		result = result.answer;
	}
	const ask = params.get("ask");
	const title = ask ? "?- " + ask : "prolog.run";
	let desc = "run some Prolog online real quick, just type in the code and go";
	if (result?.output && result?.output?.length > 0) {
		desc = result.output;
	} else if (result) {
		desc = renderDescription(result);
	}
	let subtitle;
	if (result?.meta?.application && result.meta.application != "pengine_sandbox") {
		subtitle = result.meta.application;
	}
	return html`
		<!doctype html>
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<html>
			<head>
				<title>prolog.run</title>
				${indexStyle}
				${favicon}
				<meta property="og:title" content="${title}"> 
				<meta property="og:description" content="${desc}"> 
				<meta name="twitter:card" content="summary_large_image">
				<link rel="stylesheet" href="https://esm.sh/xterm/css/xterm.css">
			</head>
			<body>
				<header>
					<h1><a href="/">𝖕𝖗𝖔𝖑𝖔𝖌.𝖗𝖚𝖓</a></h1>
					${subtitle && html`<h2>${subtitle} ${application && html`<small>(<a href="/app/${application}" target="_blank">application</a>)</small>`}</h2>`}
				</header>

				${sandbox && html`
				<section id="settings">
					<details ${meta?.src_urls?.length > 0 && html`open`}>
						<summary>Advanced</summary>
						<table class="form">
							<tr>
								${result?.meta?.application && html`
									<td><label for="application">Application:</label></td>
									<td><input type="text" placeholder="pengine_sandbox" id="application" name="application" form="query-form" value="${result.meta.application}"></td>
								`}
							</tr>
							<tr>
								<td><label for="src_url">Source URL:</label></td>
								<td><input type="text" placeholder="https://example.com/test.pl" id="src_url" name="src_url" form="query-form" value="${meta?.src_urls[0]}"></td>
							</tr>
						</table>						 
					</details>
				</section>`}

				<section id="src" class="editor">
					<div>
						<textarea id="src_text" name="src_text" form="query-form"
							class="${src_text && "loaded"}" spellcheck="false"
							placeholder="% Prolog code goes here">${src_text}</textarea>
					</div>
					
					<div id="terminal"></div>
					
				</section>

				<section id="query">
					<form method="GET" id="query-form" onsubmit="return send(arguments[0]);">
						<input type="hidden" name="id" value="${id}">
						<label for="ask">?- </label>
						<input type="text" name="ask" id="ask"
							value="${ask}"
							placeholder="member(X, [1, 2, 3])."
							list=examples>
						<input type="submit" id="query-submit" value="Query">
					</form>
					<datalist id="examples"></datalist>
				</section>

				<section id ="jobs">
					<!-- ${jobs && renderQuery(query)} -->
					<!-- ${result?.state?.queries && Object.values(result.state.queries).map((q: QueryInfo) => {
						return renderQuery(q);
					})} -->
				</section>

				<section id="results">
					${result && result.event !== "create" && renderResult(result)}
					${result?.state?.queries && Object.values(result.state.queries).map((q: QueryInfo) => {
						return renderQuery(q);
					})}
					${(isIndex === true) && renderWelcome()}
				</section>

				<br>

				${debug && debug?.dump && renderDump(debug.dump)}
				
				${result && html`
					<details id="raw" class="dump">
						<summary>Raw result</summary>
						<pre>${JSON.stringify(result, null, "  ")}</pre>
					</details>`}
				
				<br>
				
				${renderFooter(
					typeof result?.time === "number" ? `query time: ${result.time}` : undefined
				)}

				${texteditJS}
				${socketJS}
				<script>

EXAMPLE_SIGIL = "% ?- ";
QUERIES_SEEN = [];
function refreshExamples() {
	const lines = SRC_TEXT.value.split('\\n');
	const examples = lines.filter(function(x) { return x.trim().startsWith(EXAMPLE_SIGIL); });
	const frag = document.createDocumentFragment();
	const vals = new Set();
	for (const ex of examples) {
		const opt = document.createElement("option");
		const v = ex.slice(EXAMPLE_SIGIL.length);
		if (vals.has(v)) {
			continue;
		}
		vals.add(v);
		opt.value = ex.slice(EXAMPLE_SIGIL.length);
		frag.appendChild(opt);
	}
	for (const q of Array.from(document.querySelectorAll(".answer[data-ask]"))) {
		const opt = document.createElement("option");
		if (vals.has(q.dataset.ask)) {
			continue;
		}
		vals.add(q.dataset.ask);
		opt.value = q.dataset.ask;
		frag.appendChild(opt);
	}
	if (examples.length > 0) {
		document.getElementById("ask").placeholder = frag.firstChild.value;
	}
	const elem = document.getElementById("examples");
	elem.textContent = ""; // reset children :-)
	elem.appendChild(frag);
}
document.addEventListener("DOMContentLoaded", refreshExamples);
SRC_TEXT.addEventListener("blur", refreshExamples);

const QUERY_SUBMIT = document.getElementById("query-submit");
function send(event, ask, src_text, replace) {
	console.log(event, ask);
	const askElem = document.getElementById("ask")
	if (ask) {
		askElem.value = ask;
	}
	if (replace) {
		SRC_TEXT.value = src_text || "";
		updateSpacer(SRC_TEXT);
	}
	var query = {
		ask: ask || askElem.value,
		src_text: src_text || document.getElementById("src_text").value || undefined,
		src_url: document.getElementById("src_url")?.value || undefined,
		application: "${application}",
		// chunk: 1,
	};
	var url = new URL(document.URL);
	url.pathname = "/id/${application && html`${application}:`}${id}";
	url.searchParams.delete("id");
	url.searchParams.delete("application");
	for (const [k, v] of Object.entries(query)) {
		if (k == "ask" && v) {
			url.searchParams.set(k, v);
		} else if (url.searchParams.has(k)) {
			url.searchParams.delete(k);
		}
	}
	history.replaceState(query, "", url.toString());
	socket.send({cmd: "query", query: query});
	if (socket.ready()) {
		// TODO: show loading...
		QUERY_SUBMIT.value = "...";
		return false;
	}
	return undefined;
}

function send_next(id, chunk) {
	socket.send({cmd: "next", id: id, chunk: chunk});
//	if (socket.ready()) {
//		// TODO: show loading...
//		QUERY_SUBMIT.value = "...";
//		return false;
//	}
	return false;
}

function send_stop(id) {
	socket.send({cmd: "stop", id: id});
}

function send_save(id) {
	socket.send({cmd: "save", id: id});
}

function setAsk(txt) {
	const ask = document.getElementById("ask");
	ask.value = txt;
	ask.focus();
	ask.scrollIntoView({behavior: "smooth"});
	return false;
}

const socket = new Socket(location.host + "/pengine/?id=${id}", {cmd: "greetings"});

const RESULTS = document.getElementById("results");
const WELCOME = document.getElementById("welcome");

function insertEvent(html, replaceID) {
	if (typeof WECLOME !== "undefined") {
		RESULTS.innerHTML = html;
		WELCOME = undefined;
		return;
	}

	if (replaceID) {
		const elem = document.getElementById(replaceID);
		if (elem) {
			elem.outerHTML = html;
			return;
		}
	}

	RESULTS.insertAdjacentHTML("afterbegin", html);
}
function gotQuery() {
	QUERY_SUBMIT.value = "Query";
}

// TODO
socket.handle("_____result", function(msg) {
	var box = document.getElementById("results");
	if (box.querySelector("#welcome")) {
		box.innerHTML = msg;
	} else {
		box.insertAdjacentHTML("afterbegin", msg);
	}
	gotQuery();
});

socket.handle("query", function(msg) {
	const idx = msg.indexOf(":");
	const id = msg.slice(0, idx);
	const html = msg.slice(idx+1);
	insertEvent(html, "query-" + id);
	gotQuery();
});

socket.handle("src_text", function(txt) {
	// TODO: nicer
	const src_txt = document.getElementById("src_text");
	if (src_text.value !== txt) {
		src_text.value = txt;
	}
	refreshExamples();
});

socket.handle("stdout", function(msg) {
	if (window.term) { 
		window.term.write(msg);
	}
});

socket.connect();

				</script>
				${terminalJS}
			</body>
		</html>
	`;
}

function renderWelcome(): HTML {
	return html`<main id="welcome">
		<h2>Welcome</h2>
		<p>
			Are you ready to run some Prolog? Execute your query in the cloud, no JS required.<br>
			Need RPC? <a href="https://www.swi-prolog.org/pldoc/doc_for?object=section(%27packages/pengines.html%27)" target="_blank">Pengines</a> API supported as well.
			<br><br>
			
			Powered by <a href="https://github.com/tau-prolog/tau-prolog">Tau Prolog</a> and Cloudflare Workers.
		</p>
		<h3>Example queries</h3>
		<ul>
			${EXAMPLE_QUERIES.map(([src, ask]) => html`<li><a href="?ask=${ask}&src_text=${unsafeHTML(encodeURIComponent(src))}" onclick='return send(null, decodeURIComponent("${encodeURIComponent(ask)}"), ${src ? html`atob("${btoa(src)}")` : html`undefined`}, true);'>${ask}</a></li>`)}
		</ul>
		<h3>Documentation</h3>
		<ul>
			<li><a href="http://www.tau-prolog.org/documentation" target="_blank">Tau Prolog reference</a></li>
			<li><a href="https://www.swi-prolog.org/pldoc/doc_for?object=section(%27packages/pengines.html%27)" target="_blank">Pengines (RPC) API reference</a></li>
		</ul>
		<h3>Learn Prolog</h3>
		<ul>
			<li><a href="https://www.metalevel.at/prolog" target="_blank">The Power of Prolog</a></li>
		</ul>
	</main>`;
}

export function renderDump(dump: Record<string, string>): HTML {
	return html`
	<details id="dump" class="dump">
		<summary>State</summary>

		${Object.entries(dump).map(([k, v]) => html`
			<h4>${k}</h4>
			<pre>${v}</pre>
		`)}
	</details>`;
}

export function renderFooter(blurb?: string): HTML {
	return html`
	<footer>
		<div class="fleuron">⬥ ❦ ⬥</div>
		${blurb && html`<small>${blurb}</small><br>`}
		<a href="https://github.com/guregu/worker-prolog" target="_blank">worker-prolog</a>
	</footer>`;
}