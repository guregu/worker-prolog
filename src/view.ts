import { html, HTML, unsafeHTML } from "@worker-tools/html";
import { PengineResponse } from "./pengines";
import { indexStyle } from "./style";

const EXAMPLE_QUERIES: [string, string][] = [
	["", "permutation(\"dog\", Word)."],
	["", "between(1, 64, N), Square is N^2."],
	["", "json_prolog(JS, [a, [b-[c-d]], [hello-world]]), json_atom(JS, JSON)."],
	["% https://www.j-paine.org/dobbs/prolog_lightbulb.html\nchange_lightbulb(1, porlog_programmer).", "change_lightbulb(HowMany, prolog_programmer)."],
];

export function renderIndex(query: string | null, params: URLSearchParams, result?: PengineResponse) {
	if (result?.event == "create" && result?.answer) {
		result = result.answer;
	}
	return html`
		<!doctype html>
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<html>
			<head>
				<title>prolog.run</title>
				${indexStyle}
			</head>
			<body>
				<header>
					<h1><a href="/">𝖕𝖗𝖔𝖑𝖔𝖌.𝖗𝖚𝖓</a></h1>
				</header>

				<section id="settings">
					<details>
						<summary>Advanced</summary>
						<table class="form">
							<tr>
								<td><label for="id">ID:</label></td>
								<td><input type="text" placeholder="(blank to randomly generate)" id="id" name="id" form="query-form" value="${result?.id ?? params.get("id")}"></td>
							</tr>
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

				<section id="src">
					<textarea id="src_text" name="src_text" form="query-form" placeholder="% Prolog code goes here">${params.get("src_text")}</textarea>
				</section>

				<section id="query">
					<form method="GET" id="query-form">
						<label for="ask">?- </label>
						<input type="search" name="ask" id="ask"
							value="${params.get("ask")}"
							placeholder="member(X, [1, 2, 3])."
							list=examples>
						<input type="submit" value="Query">
					</form>
					<datalist id="examples"></datalist>
				</section>

				<section id="results">
					${!result && html`
						<main>
							<h2>Welcome</h3>
							<p>
								Are you ready to run some Prolog? Execute your query in the cloud, no JS required.<br>
								Need RPC? <a href="https://www.swi-prolog.org/pldoc/doc_for?object=section(%27packages/pengines.html%27)" target="_blank">Pengines</a> API supported as well.
								<br><br>
								
								👷 Under Construction 🚧 
							</p>
							<h3>Example queries:</h3>
							<ul>
								${EXAMPLE_QUERIES.map(([src, ask]) => html`<li><a href="?ask=${ask}&src_text=${unsafeHTML(encodeURIComponent(src))}">${ask}</a></li>`)}
							</ul>
						</main>
					`}
					${renderAnswersTable(result)}
				</section>

				<br>
				
				${result && html`
					<details id="raw" class="dump">
						<summary>Raw result</summary>
						<code>${JSON.stringify(result)}</code>
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
SRC_TEXT.addEventListener("keydown", (e) => {
	if (e.key == "Tab" && !e.shiftKey) {
		e.preventDefault()
		e.target.setRangeText(
			"\t",
			e.target.selectionStart,
			e.target.selectionStart,
			"end"
		);
	}
});

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
			<table>
				<thead>
					<tr>
						${result?.projection.map(x => html`<th>${x}</th>`)}
					</tr>
				</thead>
				<tbody>
					${result?.data?.map(renderAnswerTable)}
				</tbody>
			</table>
		`;
	}

	return html`unknown event: ${result.event}`;
}

function renderAnswerTable(x: Record<string, any>): HTML {
	const entries = Object.entries(x);

	if (entries.length == 0) {
		return html`👍 <b class="answer true">yes</b>`;
	}

	/* eslint-disable indent */
	return html`
		<tr>
			${Object.entries(x).map(function([k, v]) {
				return html`<td>${renderTerm(v)}</td>`;
			})}
		</tr>
	`;
	/* eslint-enable */
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