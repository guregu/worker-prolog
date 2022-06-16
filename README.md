# worker-prolog

Serverless persistent Prolog via [Tau Prolog](http://www.tau-prolog.org/) and [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/). Implements the [Pengines](https://pengines.swi-prolog.org/docs/index.html) API.

## Demo

👉 https://prolog.run

## What is this?

- Run Prolog code quickly and easily online
	- Simple and responsive HTML interface for exploring and sharing queries
	- Easily sharable URLs for smooth collaboration
	- Supports text output (via `write/1` etc.) and tabular output for variables
	- Pretty printing of JSON atoms and complex terms
	- Built-in examples feature with typeahead suggestions
- JSON and Prolog programmatic RPC interface through the Pengines API
	- Simply point any [Pengines-compatible](https://github.com/SWI-Prolog/swish/tree/master/client) client library at `https://prolog.run` to start using Prolog. Many languages are supported such as Python, Go, Ruby, JS...
	- Baby steps towards a true Semantic Web with rich querying support.
- Persistent, serverless Prolog interpreter in the cloud
	- Interpreter state and dynamic knowledge base is persistent
		- Clauses added/removed with `assertz/1` and `retractall/1` et. al. are saved via Durable Objects, letting you use prolog.run as a persistent database.
	- Query state is also persistent (Pengines chunk option is supported in the API, but no UI for it yet)

## Development Status

Currently **MVP** status. All of the above features work. Persistence is experimental and there is no permissions system stopping someone from deleting all your stuff. Stay tuned for proper Pengines application support, which will allow users to upload scripts to R2 and associate them with long-lived interpreters.

### TODO:

- [ ] Better persistence
	- [x] Application state (#2)
	- [ ] TTL for query state, deleting stale queries via Worker Alarms
- [ ] Uploading scripts to R2 → replace src_text with R2 reference (cleaner URLs)
- [ ] Cloudflare SDK library for Prolog to call directly from Prolog programs
- [x] Real-time query output and chat (join a query with the same ID to see each other's results!)
- [ ] Namespaces, maybe at `subdomain.prolog.run`, with customizable read/write permissions and simple user system (use OpenID?)

#### If you work at Cloudflare... 🙏

I would love to experiment with **D1 support**, so if you can hook me up with a beta invite please [keep in touch](mailto:greg.roseberry@gmail.com). As crazy as it sounds, I think Prolog would be an extremely viable language for the Cloudflare ecosystem and I'd like to help make first-class Prolog support a reality.

Currently persistence is limited by Durable Object's storage API limits, so the source text or a particular predicate's code cannot exceed 128KB, for example. Hopefully this could be improved by D1.

## Towards a Semantic Web

My vague goal for this project is to facilitate an easy way to experiment with the Semantic Web. You can think of a Prolog query as kind of a beefed-up version of GraphQL. It's the ultimate abstract API for querying and transforming any kind of data.

Cool stuff I'd like to try:

- Displaying form elements via Prolog scripts for easy input/output to take advantage of persistence
	- See the [Guestbook Demo](https://prolog.run/?id=guestbook&src_text=%3A-+dynamic%28signed%2F3%29.%0D%0A%0D%0Asign%28By%2C+Msg%29+%3A-%0D%0A%09get_time%28T%29%2C%0D%0A%09findall%28X%2C+time_property%28T%2C+X%29%2C+Date%29%2C%0D%0A%09asserta%28signed%28By%2C+Date%2C+Msg%29%29.%0D%0A%0D%0A%25+%3F-+sign%28anonymous%2C+%27hello+%E4%B8%96%E7%95%8C%27%29.%0D%0A%25+%3F-+signed%28By%2C+Date%2C+Msg%29.&ask=) for a taste of what it could become.
- Support for rendering output to an alternative protocol like Gemini
- Using prolog.run as the dynamic backend of a statically deployed site

## Thanks

- [Tau Prolog](http://www.tau-prolog.org/) does all the heavy lifting.
- [@yarnpkg/berry](https://github.com/yarnpkg/berry/tree/master/packages/plugin-constraints/sources) for hints on how to use Tau with TS.
- [worker-tools/html](https://github.com/worker-tools/html) for super easy HTML rendering.
