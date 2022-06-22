import { html }  from "@worker-tools/html";

export const favicon = html`
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text x=%22-.1em%22 y=%22.9em%22 font-size=%2290%22>🤠</text></svg>">
`;

export const indexStyle = html`
<style>
		html {
				color: #000;
				background: #fff;
				overflow-y: scroll;
				-webkit-text-size-adjust: 100%;
				-ms-text-size-adjust: 100%
		}

		html * {
				outline: 0;
				-webkit-text-size-adjust: none;
				-webkit-tap-highlight-color: rgba(0, 0, 0, 0)
		}

		body {
				margin: 0;
				font-family: sans-serif;
		}

		body > *:not(#query) {
				margin: 8px;
		}

		a, a:visited {
				color: black;
				text-decoration-thickness: from-font;
		}

		header h1 a, header h1 a:visited {
				text-decoration: none;
		}
		header h1 a:hover {
				text-decoration: underline;
		}

		.error {
				color: red;
		}

		#query {
				position: sticky;
				top: 0;
				background: #f7f7f7b3;
				backdrop-filter: blur(var(--frost-blur, 6px));
				-webkit-backdrop-filter: blur(var(--frost-blur, 6px));
				margin: 0;
				padding-left: 8px;
				padding-right: 8px;
		}

		#query form {
				padding-bottom: 0.5em;
				display: flex;
				align-items: center;
		}
		#query form > * {
				margin-top: 5px;
				margin-right: 5px;
		}
		#query form label[for=ask] {
				font-size: large;
				font-family: monospace;
		}
		#query form #ask {
				flex: 1;
		}

		#query-submit {
			width: 5em;
		}

		/* https://qiita.com/tsmd/items/fce7bf1f65f03239eef0 */
		
		.growtext {
			position: relative;
			font-size: 1rem;
			line-height: 1.8;
		}

		.growtext .spacer {
			padding-top: 5px;
			padding-bottom: 5px;
			font-family: monospace;
			overflow: hidden;
			visibility: hidden;
			box-sizing: border-box;
			min-height: 120px;
			white-space: pre-wrap;
			word-wrap: break-word;
			overflow-wrap: break-word;
			border: 1px solid;
			line-height: normal;
		}

		.growtext textarea {
			position: absolute;
			top: 0;
			left: 0;
			display: block;
			overflow: hidden;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			background-color: transparent;
			resize: none;
		}

		.growtext textarea:focus {
			box-shadow: 0 0 0 4px rgba(35, 167, 195, 0.3);
			outline: 0;
		}

		section {
				margin: 0.3em;
		}

		details {
				border: 1px dotted lightgrey;
				max-width: 100%;
		}
		details.dump {
				overflow-y: auto;
		}
		details summary {
				background: #efefeb;
				padding: 0.3em;
				cursor: pointer;
		}
		details > *:not(summary) {
				margin: 0.3em;
		}

		details input {
			width: min(calc(100% - 8px), 80ch);
		}

		#src {
			max-height: 50vh;
			overflow-y: auto;
		}

		input, textarea, .growtext .spacer {
				font-size: 16px;
				tab-size: 4;
		}

		fieldset.answer {
			border: 1px solid lightgrey;
		}

		.answer p.ask {
			font-size: smaller;
			font-style: italic;
		}
		.answer p.ask a, .answer p.ask a:visited {
			color: inherit;
			text-decoration: none;
		}
		.answer p.ask a:hover {
			color: inherit;
			text-decoration: underline;
		}

		table.form {
				width: 98%;
		}
		table.form td:first-of-type{
				width: 15ch;
		}

		.answer.false {
				color: crimson;
		}

		#results table {
				margin: 1px;
				border-collapse: collapse;
		}
		#results th, #results td {
				border: 1px solid lightgrey;
				padding: 0.3em;
		}
		#results th {
			background: #f4f4f4;
		}

		blockquote.output {
			background: #1b1a1a;
			color: white;
    		/* font-family: monospace; */
			font-size: medium;
			margin: 0.3em;
    		padding: 1em;
			white-space: pre-wrap;
			overflow: auto;
			word-break: keep-all;
			overflow-wrap: normal;
		}
		blockquote.output:empty {
			display: none;
		}

		footer {
				padding-top: 1em;
				text-align: center;
				color: #bdbdbd;
		}
		footer a, footer a:visited {
				color: #b5a7c9;
		}
</style>`;