# modules

## directives

### use_module(application/1).

Links with an application module with the given ID. Edit them at /app/{id}. WIP.

```prolog
:- use_module(application(foo)).
// see: https://prolog.run/app/foo
```

## library(engine)

OS-ish module, auto-imported.

### stop/0

Kills all queries currently running in this pengine (including the stop query, whoops).

```prolog
stop.
```

### stop/1

Kills a query with the given ID.

```prolog
%% stop(+ID) is det.
stop(ID).
```

### self/1

Binds ID to the current pengine's ID.

```prolog
%% self(-ID) is det.
self(ID).
```

### current_query/1

Binds ID successively to currently running query IDs.

```prolog
%% current_query(-ID) is det.
current_query(ID).
```

### sleep/1

Sleeps (the query, not the pengine) for the given amount of milliseconds.
Doesn't play well with serverless so YMMV. If your queries run too long it just kind of blows up.

```prolog
%% sleep(Milliseconds) is det.
sleep(M).
```

## library(tty)

Module for writing to the terminal. Auto-imported. The terminal is hooked up to the default output stream but can be explicitly referenced by the stream alias `stdout`, at least until I figure out what it's supposed to be called.

Coordinates are expressed as `X/Y` with `1/1` as the origin in the upper left, corresponding with the ANSI specification.

### tty_clear/0

Clears the screen, resetting it to the default colors and moving the cursor to the origin (`1/1`).

```prolog
%% tty_clear is det.
tty_clear.
```

### tty_flush/0

Flushes the standard output stream. worker-prolog will automatically flush this after a query yields a solution, so you don't need to do this unless you want to write to the screen more than once per solution.

```prolog
%% tty_flush is det.
tty_flush :- flush_output(stdout).
```

### tty_fill/1, tty_fill/3

Like `tty_clear/0` but takes a color as its argument to fill the screen with.

```prolog
%% tty_fill(+Color) is det.
%% tty_fill(+R, +G, +B) is det.
tty_fill(1). % red.
tty_fill(224, 176, 255) % mauve.
```

### tty_at/1

Moves the cursor to `X/Y`.

```prolog
% tty_at(+Coord) is det.
tty_at(1/1). % move to origin
tty_at(10/2). % move to column 10 row 2
```

### tty_sgr/1

Select Graphics Rendition. Sets visual properties for text.
Use `tty_write/2` for writing text and setting SGR in one predicate.

### tty_write/2

Writes Text to the terminal, first applying Options.

```prolog
%% tty_write(+Text, +Options) is det.
% example: writes "im lovin at" at column 10 row 5 with a red background and bold yellow text
tty_write('im lovin it', [at(10/5), fg(3), bg(1), bold]).
```

### Options

| Option  | Description        |
|---------|--------------------|
| at(X/Y) | move cursor to X/Y |

#### SGR Options

| Option  | Description        |
|---------|--------------------|
| reset | resets SGR to defaults |
| bold | bold weight (bright) text |
| dim | dim text |
| italic | italic text |
| underline | underline text |
| inverse | inverse cell colors (swaps foreground/background) |
| underline | underline text |
| hidden | hidden text |
| strikethrough | strikethrough text |
| fg | default foreground color |
| fg(Color) | sets foreground to Color (0-255) |
| fg(R, G, B) | sets foreground to RGB color |
| bg | default background color |
| bg(Color) | sets background to Color (0-255) |
| bg(R, G, B) | sets background to RGB color |
