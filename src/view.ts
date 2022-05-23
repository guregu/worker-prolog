import {html, HTML} from "@worker-tools/html";

export function renderIndex(query: string | null, params: URLSearchParams, result?: any) {
	return html`
		<!doctype html>
		<html>
			<head>
				<title>Pengines on Workers</title>
				<style>
					.error {
						color: red;
					}
					.answer.false {
						color: crimson;
					}
					.time-taken {
						color: gray;
					}
					#results table {
						border-collapse: collapse;
						margin: 1px;
					}
					#results th, #results td {
						border: 1px solid lightgrey;
						padding: 0.3em;
					}

					section {
						margin: 3px;
					}
				</style>
			</head>
			<body>
				<h1>Pengines</h1>
				<form method="GET" action="">
					${params.get("src_url") && html`<input type="hidden" value="${params.get("src_url")}"} name="src_url">`}
					<label for="ask">?- </label> <input type="text" name="ask" id="ask"
					${params.get("ask") && html`value="${params.get("ask")}"`}
					placeholder="member(X, [1, 2, 3]).">
					<input type="submit" value="Query">
					${result?.time && html`<span class="time-taken" title="time taken">${result?.time}s</span>`}
				</form>
				<section id="results">
					${renderAnswersTable(result)}
				</section>
				<br>
				${result && html`
					<details id="raw">
						<summary>Raw result</summary>
						<code>${JSON.stringify(result)}</code>
					</details>`}
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