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

export function renderIndex(query: string | null, params: URLSearchParams, result?: PengineResponse) {
	const meta = result?.meta ?? result?.answer?.meta ?? result?.data?.meta;
	if (result?.event == "create" && result?.answer) {
		result = result.answer;
	}
	const ask = params.get("ask");
	const title = ask ? "?- " + ask : "prolog.run";
	let desc = "run some Prolog online real quick, just type in the code and go";
	if (result && result?.output?.length > 0) {
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
			</head>
			<body>
				<header>
					<h1><a href="/">𝖕𝖗𝖔𝖑𝖔𝖌.𝖗𝖚𝖓</a></h1>
					${subtitle && html`<h2>${subtitle}</h2>`}
				</header>

				<section id="settings">
					<details>
						<summary>Advanced</summary>
						<table class="form">
							<tr>
								<td><label for="application">Application:</label></td>
								<td><input type="text" placeholder="pengine_sandbox" id="application" name="application" form="query-form" value="${params.get("application")}"></td>
							</tr>
							<tr>
								<td><label for="src_url">Source URL:</label></td>
								<td><input type="text" placeholder="https://example.com/test.pl" id="src_url" name="src_url" form="query-form" value="${params.get("src_url")}"></td>
							</tr>
						</table>						 
					</details>
				</section>

				<section id="src" class="growtext">
					<div class="spacer" aria-hidden="true">${meta?.src_text ?? params.get("src_text")}</div>
					<textarea id="src_text" name="src_text" form="query-form"
						class="${meta?.src_text && "loaded"}" spellcheck="false"
						placeholder="% Prolog code goes here">${meta?.src_text ?? params.get("src_text")}</textarea>
				</section>

				<section id="query">
					<form method="GET" id="query-form">
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
					${!result && !params.get("src_text") && html`
						<main>
							<h2>Welcome</h3>
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
						</main>
					`}
					${renderAnswersTable(result)}
				</section>

				<br>

				${result?.meta?.app_src && html`
					<details id="raw" class="dump">
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
				</script>
			</body>
		</html>
	`;
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

function renderAnswer(x: Record<string, any>): HTML {
	const entries = Object.entries(x);

	if (entries.length == 0) {
		return html`<li><b class="answer true">yes</b></fli>`;
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


function renderAnswersTable(result: any): HTML {
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
			💡 <b class="answer false">no</b>
			</div>
		`;
	case "success":
		return html`
			<blockquote class="output">${result.output}</blockquote>
			<table>
				<thead>
					<tr>
						${result?.projection.map(x => html`<th>${x}</th>`)}
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
		return html`👍 <b class="answer true">yes</b>`;
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
	switch (result.event) {
	case "failure":
		return "💡 no";
	case "error":
		return `😵 error: ${renderTermText(result?.data)}`;
	}

	let projection = result.projection ?? [];
	let data = result?.data;
	if (!data) {
		return "(empty)";
	}

	return data.map(function(x) {
		const entries = Object.entries(x);
		if (entries.length == 0) {
			return "👍 yes";
		}
		return entries.map(function([k, v]) {
			if (!projection.includes(k)) { return null; }
			return `${k} = ${renderTermText(v)}`;
		}).join(", ");
	}).join(" ;\n") + ".";
}

function renderTerm(x: any): HTML {
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