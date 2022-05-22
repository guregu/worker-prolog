import {html, HTML} from "@worker-tools/html";

export function renderIndex(query: string | null, result?: any) {
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
				</style>
			</head>
			<body>
				<h1>Pengines</h1>
				<form method="GET" action="">
					<label for="ask">?- </label> <input type="text" name="ask" id="ask" placeholder="member(X, [1, 2, 3])." autofocus>
					<input type="submit" value="Query">
				</form>
				<section>
					${renderAnswers(result)}
				</section>
				<details>
					<summary>Raw result</summary>
					${JSON.stringify(result)}
				</details>
				<script>
					var query = "${query}".trim();
					if (!!query) {
						document.getElementById("ask").value = query;
					}
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