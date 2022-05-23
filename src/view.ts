import { html, HTML } from "@worker-tools/html";
import { indexStyle } from "./style";

const EXAMPLE_QUERIES = [
	"member(X, [1, two, cool(prolog)]).",
	// eslint-disable-next-line quotes
	`permutation("dog", Permutation).`,
	"between(1, 64, N), Square is N^2."
];

const SRC_TEXT_PLACEHOLDER = "% Prolog code goes here\nmortal(socrates).";

export function renderIndex(query: string | null, params: URLSearchParams, result?: any) {
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
								<td><label for="application">Application:</label></td>
								<td><input type="text" placeholder="pengine_sandbox" id="application" name="application" form="query-form"></td>
							</tr>
							<tr>
								<td><label for="src_url">Source URL:</label></td>
								<td><input type="text" placeholder="https://example.com/test.pl" id="src_url" name="src_url" form="query-form" ${params.get("src_url") && html`value="${params.get("src_url")}"`}></td>
							</tr>
						</table>						 
					</details>
				</section>

				<section id="src">
					${params.get("src_text") && html`<textarea id="src_text" name="src_text" form="query-form" placeholder="${SRC_TEXT_PLACEHOLDER}">${params.get("src_text")}</textarea>`}
					${!params.get("src_text") && html`<textarea id="src_text" name="src_text" form="query-form" placeholder="${SRC_TEXT_PLACEHOLDER}"></textarea>`}
				</section>

				<section id="query">
					<form method="GET" id="query-form">
						<label for="ask">?- </label>
						<input type="text" name="ask" id="ask"
						${params.get("ask") && html`value="${params.get("ask")}"`}
						placeholder="member(X, [1, 2, 3]).">
						<input type="submit" value="Query">
					</form>
				</section>

				<section id="results">
					${!result && html`
						<main>
							<h2>Welcome</h3>
							<p>
								Serverless Prolog (Pengines) under construction 👷
							</p>
							<h3>Example queries:</h3>
							<ul>
								${EXAMPLE_QUERIES.map(x => html`<li><a href="?ask=${x}">${x}</a></li>`)}
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
					${typeof result?.time == "number" && html`<small>query time: ${result.time} sec</small>`}<br>
					🙡🙠 <a href="https://github.com/guregu/worker-prolog" target="_blank">worker-prolog</a> 🙢🙣
				</footer>
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
			🙅 <b class="answer false">no</b>
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
	case "string":
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