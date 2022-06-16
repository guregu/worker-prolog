import { html, HTML, unsafeHTML } from "@worker-tools/html";
import { PengineResponse } from "../response";
import { favicon, indexStyle } from "./style";

const EXAMPLE_QUERIES: [string, string][] = [
	["", "permutation(\"dog\", Word)."],
	["% https://en.wikipedia.org/wiki/Syllogism\n\nhuman(socrates).\nmortal(X) :- human(X).", "mortal(X)."],
	["fizzbuzz(N, Max) :- \n	N =< Max,\n	findall(_, say(N), _), nl,\n	succ(N, N1),\n	fizzbuzz(N1, Max).\nfizzbuzz(N, Max) :- succ(Max, N).\n\nsay(N) :- 0 is N mod 3, write('fizz').\nsay(N) :- 0 is N mod 5, write('buzz').\nsay(N) :-\n	X is N mod 3,\n	X \\= 0,\n	Y is N mod 5,\n	Y \\= 0,\n	write(N).\n\n% ?- fizzbuzz(1, 15)", "fizzbuzz(1, 15)."],
	["", "between(1, 32, N), Square is N^2, Cube is N^3."],
	["% http://www.tau-prolog.org/documentation#js\n% https://github.com/tau-prolog/tau-prolog/issues/299\n:- use_module(library(js)).\n", "json_prolog(_JS, [a, [x-[yes-{true}, no-{false}, '$1b mistake'-{null}]], [hello-prolog, born-1972]]), json_atom(_JS, JSON)."],
	["% https://www.j-paine.org/dobbs/prolog_lightbulb.html\n\nchange_lightbulb(1, porlog_programmer).", "change_lightbulb(HowMany, prolog_programmer)."],
];

export function renderIndex(sandbox: boolean, params: URLSearchParams, result?: PengineResponse) {
	const meta = result?.meta ?? result?.answer?.meta ?? result?.data?.meta;
	const id = result?.id || crypto.randomUUID();
	if (result?.event == "create" && result?.answer) {
		result = result.answer;
	}
	const application = result?.meta?.application;
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
	console.log("REZZ", result);
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
			</head>
			<body>
				<header>
					<h1><a href="/">𝖕𝖗𝖔𝖑𝖔𝖌.𝖗𝖚𝖓</a></h1>
					${subtitle && html`<h2>${subtitle}</h2>`}
				</header>

				${sandbox && html`
				<section id="settings">
					<details>
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
								<td><input type="text" placeholder="https://example.com/test.pl" id="src_url" name="src_url" form="query-form" value="${params.get("src_url")}"></td>
							</tr>
						</table>						 
					</details>
				</section>`}

				<section id="src">
					<div class="growtext">
						<div class="spacer" aria-hidden="true">${meta?.src_text ?? params.get("src_text")}</div>
						<textarea id="src_text" name="src_text" form="query-form"
							class="${meta?.src_text && "loaded"}" spellcheck="false"
							placeholder="% Prolog code goes here">${meta?.src_text ?? params.get("src_text")}</textarea>
					</div>
				</section>

				<section id="query">
					<form method="GET" id="query-form" onsubmit="return send(arguments[0]),false;">
						<input type="hidden" name="id" value="${id}">
						<label for="ask">?- </label>
						<input type="text" name="ask" id="ask"
							value="${ask}"
							placeholder="member(X, [1, 2, 3])."
							list=examples>
						<input type="submit" value="Query">
					</form>
					<datalist id="examples"></datalist>
				</section>

				<section id="results">
					${!result && !params.get("src_text") && renderWelcome()}
					${result && renderResult(result)}
				</section>

				<br>

				${result?.meta?.app_src && html`
					<details id="app_src" class="dump">
						<summary>Application State</summary>
						<pre>${result?.meta?.app_src}</pre>
					</details>`}
				
				${result && html`
					<details id="raw" class="dump">
						<summary>Raw result</summary>
						<pre>${JSON.stringify(result, null, "  ")}</pre>
					</details>`}
				
				<br>
				
				<footer>
					<div class="fleuron">⬥ ❦ ⬥</div>
					${typeof result?.time == "number" && html`<small>query time: ${result.time} sec</small><br>`}
					<a href="https://github.com/guregu/worker-prolog" target="_blank">worker-prolog</a>
				</footer>

				<script>

SRC_TEXT = document.getElementById("src_text");
// support tabs in editor
SRC_TEXT.addEventListener("keydown", function(e) {
	if (e.key == "Tab" && !e.shiftKey) {
		e.preventDefault()
		e.target.setRangeText(
			"\\t",
			e.target.selectionStart,
			e.target.selectionStart,
			"end"
		);
	} else if (e.key == "Enter") {
		const caret = e.target.selectionStart;
		const lineStart = e.target.value.lastIndexOf("\\n", caret-1) + 1;
		const line = e.target.value.slice(lineStart, caret);
		if (line.startsWith("\\t") && !line.trim().endsWith(".")) {
			for (var ct = 0; ct < line.length && line[ct] == "\\t"; ct++) {}
			const tab = "\\t".repeat(ct);
			e.preventDefault();
			e.target.setRangeText(
				"\\n" + tab,
				e.target.selectionStart,
				e.target.selectionStart,
				"end"
			);
		}
	}
	updateSpacer(e.target);
});
SRC_TEXT.addEventListener("input", function(e) {
	updateSpacer(e.target);
})
function updateSpacer(textarea) {
	const spacer = textarea.parentElement.querySelector(".spacer");
	if (spacer) {
		spacer.textContent = textarea.value + "\\u200b";
	}
}

EXAMPLE_SIGIL = "% ?- ";
function refreshExamples() {
	const lines = SRC_TEXT.value.split('\\n');
	const examples = lines.filter(function(x) { return x.trim().startsWith(EXAMPLE_SIGIL); });
	const frag = document.createDocumentFragment();
	for (const ex of examples) {
		const opt = document.createElement("option");
		opt.value = ex.slice(EXAMPLE_SIGIL.length);
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

function send(event) {
	console.log(event);
	var query = {
		ask: document.getElementById("ask").value,
		src_text: document.getElementById("src_text").value || undefined,
		src_url: document.getElementById("src_url").value || undefined,
		${application && html`application: ${application}`}
	};
	var url = new URL(document.URL);
	for (const [k, v] of Object.entries(query)) {
		if (v) {
			url.searchParams.set(k, v);
		} else if (url.searchParams.has(k)) {
			url.searchParams.delete(k);
		}
	}
	url.searchParams.set("id", "${id}");
	history.replaceState(query, "", url.toString());
	socket.send({cmd: "query", query: query});
}

window.Socket = function(url, hello) {
	this.socket = null;
	this.url = url;
	this.msgq = [];
	this.hello = hello;
	this.handlers = {};
	this.reconnector = null;
	this.reconnectDelay = 1000;
	this.reconnectN = 0;

	this.onconnect = null;
	this.onreconnect = null;
	this.onbeforeunload = null;
	this.onfail = null;

	this.send = function(msg) {
		msg = JSON.stringify(msg);
		if (!this.socket || this.socket.readyState != WebSocket.OPEN) {
			this.msgq.push(msg);
		} else {
			this.socket.send(msg);
		}
	}

	this.connect = function(reconnect) {
		if (this.reconnector) { clearTimeout(this.reconnector); }

		var proto = "ws://";
		if (window.location.protocol === "https:") {
				proto = "wss://";
		}
		try {
			this.socket = new WebSocket(proto + this.url);
		} catch(ex) {
			console.log(ex);
			if (this.onfail) {
				this.onfail();
			}
		}
		this.socket.onopen = function() {
			console.log("yee haw");
			if (reconnect && this.onreconnect) {
				this.onreconnect();
			}
			if (this.hello) {
				this.send(this.hello);
			}
			this.msgq.forEach(function(msg) {
				this.socket.send(msg);
			}.bind(this));
			this.msgq = [];
			this.reconnectDelay = 1000;
			this.reconnectN = 0;

			if (this.onconnect) {
				this.onconnect();
			}
		}.bind(this);

		this.socket.onclose = function(e) {
			console.log("closed");
			this.reconnector = setTimeout(function() {
				this.reconnectN++;
				this.connect(true);
				this.reconnectDelay = this.reconnectDelay * 1.25;
			}.bind(this), this.reconnectDelay + (Math.random()*1000));
		}.bind(this);

		this.socket.onmessage = function(e) {
			var data = e.data.toString();
			var idx = data.indexOf(':');
			if (idx == -1) {
				console.log("msg without channel", data);
				return;
			}
			var chan = data.slice(0, idx);
			var msg = data.slice(idx + 1);
			if (this.handlers[chan]) {
				this.handlers[chan](msg);
			} else {
				console.log("unhandled msg", chan, msg);
			}
		}.bind(this);

		this.socket.onerror = function(err) {
			console.log("socket error", err);
		};
	}

	this.handle = function(channel, fn) {
		this.handlers[channel] = fn;
	}

	window.addEventListener("beforeunload", function(event) {
		this.socket.onclose = null;
		this.socket.close(1000, "bye!");
		if (this.onbeforeunload) {
			this.onbeforeunload();
		}
	}.bind(this));
}

const socket = new Socket(location.host + "/ws?id=${id}", {cmd: "greetings"});
socket.handle("result", function(msg) {
	var box = document.getElementById("results");
	if (box.querySelector("#welcome")) {
		box.innerHTML = msg;
	} else {
		box.insertAdjacentHTML("afterbegin", msg);
	}
	console.log(msg);
});
socket.connect();
				</script>
			</body>
		</html>
	`;
}

export function renderResult(result: PengineResponse): HTML {
	return html`
	<fieldset class="answer" data-ask="${result.ask}">
		<legend><span>${eventEmoji(result)} ${new Date().toLocaleTimeString()}</span></legend>
		<!-- <div class="ask">${result.ask}</div> -->
		<blockquote class="output">${result?.output}</blockquote>
		${renderAnswersTable(result)}
	</fieldset>`;
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
			${EXAMPLE_QUERIES.map(([src, ask]) => html`<li><a href="?ask=${ask}&src_text=${unsafeHTML(encodeURIComponent(src))}">${ask}</a></li>`)}
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
	</main>`
}

function renderAnswers(result: any): HTML {
	if (!result) {
		return html``;
	}

	switch (result.event) {
	case "error":
		return html`
			<ul>
				<li>
					<b class="answer error">Error</b>: ${renderTerm(result.data)}
				</li>
			</ul>
		`;
	case "failure":
		return html`
			<ul>
				<li>
					<b class="answer false">no</b>
				</li>
			</ul>
		`;
	case "success":
		return html`
			<ul>
				${result?.data?.map(renderAnswer)}
			</ul>
		`;
	}

	return html`unknown event: ${result.event}`;
}

function eventEmoji(result: PengineResponse): string {
	switch (result.event) {
	case "success":
		return "👍";
	case "failure":
		return "💡";
	case "error":
		return "😵";
	default:
		return "❓";
	}
}

function renderAnswer(x: Record<string, any>): HTML {
	const entries = Object.entries(x);

	if (entries.length == 0) {
		return html`<li><b class="answer true">yes</b></li>`;
	}

	/* eslint-disable indent */
	return html`
		<li>
			${Object.entries(x).map(function([k, v], i) {
				const sep = (i == 0) ?  "" : ", ";
				return html`${sep}<span><b>${k}</b>: ${renderTerm(v)}</span>`;
			})}
		</li>
	`;
	/* eslint-enable */
}


function renderAnswersTable(result?: PengineResponse): HTML {
	if (!result) {
		return html``;
	}

	switch (result.event) {
	case "error":
		return html`
			<div>
				<b class="answer error">Error</b>: ${renderTerm(result.data)}
			</div>
		`;
	case "failure":
		return html`
			<div>
				<b class="answer false">no</b>
			</div>
		`;
	case "success":
		return html`
			<table>
				<thead>
					<tr>
						${result?.projection?.map(x => html`<th>${x}</th>`)}
					</tr>
				</thead>
				<tbody>
					${result?.data?.map(renderAnswerTable.bind(null, result?.projection))}
				</tbody>
			</table>
		`;
	case "create":
		return html``;
	}

	return html`unknown event: ${result.event}`;
}

function renderAnswerTable(projection: string[], x: Record<string, any>): HTML {
	const entries = Object.entries(x);

	if (entries.length == 0) {
		return html`<b class="answer true">yes</b>`;
	}

	/* eslint-disable indent */
	return html`
		<tr>
			${entries.map(function([k, v]) {
				if (!projection.includes(k)) { return null; }
				return html`<td>${renderTerm(v)}</td>`;
			})}
		</tr>
	`;
	/* eslint-enable */
}

function renderDescription(result: PengineResponse): string {
	const emoji = eventEmoji(result);
	switch (result.event) {
	case "failure":
		return `${emoji} no`;
	case "error":
		return `${emoji} error: ${renderTermText(result?.data)}`;
	}

	let projection = result.projection ?? [];
	let data = result?.data;
	if (!data) {
		return "(empty)";
	}

	return data.map(function(x) {
		const entries = Object.entries(x);
		if (entries.length == 0) {
			return `${emoji} yes`;
		}
		return entries.map(function([k, v]) {
			if (!projection.includes(k)) { return null; }
			return `${k} = ${renderTermText(v)}`;
		}).join(", ");
	}).join(" ;\n") + ".";
}

function renderTerm(x: any): HTML {
	console.log("REnderTerm", x);
	switch (typeof x) {
	case "number":
		return html`${x}`;
	case "string":
		if ((x.startsWith("{") && x.endsWith("}")) || (x.startsWith("[") && x.endsWith("]"))) {
			try {
				const obj = JSON.parse(x);
				return html`<pre>${JSON.stringify(obj, null, 2)}</pre>`;
			} catch {
				//
			}
		}
		return html`${x}`;
	default:
		if (x == null) {
			return html`<i>null</i>`;
		}
		
		// lists
		if (Array.isArray(x)) {
			return html`[${x.map(function(v, i) {
				const result = renderTerm(v);
				if (i > 0) {
					return html`, ${result}`;
				}
				return html`${result}`;
			})}]`;
		}

		if (typeof x.pretty == "string") {
			return html`${x.pretty}`;
		}

		// compound
		if (typeof x.functor == "string") {
			return html`${x.functor}(${x.args.map(function(v: any, i: number) {
				const result = renderTerm(v);
				if (i > 0) {
					return html`, ${result}`;
				}
				return html`${result}`;
			})})`;
		}

		// hail mary
		return html`??? ${JSON.stringify(x)}`;
	}
}


function renderTermText(x: any): string {
	switch (typeof x) {
	case "number":
	case "string":
		return `${x}`;
	default:
		if (x == null) {
			return "null";
		}
		
		// lists
		if (Array.isArray(x)) {
			return `[${x.map(renderTermText).join(", ")}]`;
		}

		if (typeof x.pretty == "string") {
			return x.pretty;
		}

		// compound
		if (typeof x.functor == "string") {
			return `${x.functor}(${x.args.map(function(v: any, i: number) {
				const result = renderTermText(v);
				if (i > 0) {
					return `, ${result}`;
				}
				return `${result}`;
			})})`;
		}

		// hail mary
		return `??? ${x}`;
	}
}