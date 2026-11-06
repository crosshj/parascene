# Ollama web playground

This is a small, standalone local web app for an Ollama server on the network.
It uses only Node.js built-ins.

On startup it sends an empty, non-streaming generation request so Ollama loads
the selected model before you start chatting. The default keep-alive is `10m`;
change it with `OLLAMA_KEEP_ALIVE` or `settings.json`.

## Run it

From this directory:

```bash
npm start
```

Open http://127.0.0.1:4321. On startup the app checks the remote
`parascene-gemma` definition against `Modelfile`. If it is missing or changed,
the app deletes and recreates only that app-owned model, then loads it before
the app reports that it is ready.

The server automatically manages the app-owned `parascene-gemma` model from
the checked-in `Modelfile`; model setup is intentionally not exposed in the
web UI.

## Create the customized model

The checked-in [Modelfile](./Modelfile) configures Gemma 3 12B for conservative,
honest coding and image analysis. You can create it from the UI, or run this on
the Mac Mini from a copy of this directory:

```bash
ollama create parascene-gemma -f Modelfile
```

Then select `parascene-gemma:latest` in the web app. The original
`gemma3:12b` remains available as a comparison model.

The server terminal logs startup, status checks, model loading, chat requests,
image attachments, completed streams, and errors with timestamps.

The first run uses `settings.example.json` defaults in memory. Copy it to
`settings.json` to customize the local connection, model, or system prompt:

```bash
cp settings.example.json settings.json
```

`settings.json` is intentionally ignored by git. It stores local preferences.

```bash
OLLAMA_HOST=http://192.168.1.50:11434 npm start
npm start -- --model llama3.2
```

Images can be pasted directly into the prompt, selected with Attach image, or
dragged onto it. This requires a vision-capable model.

Refresh the page to clear the current conversation context; the server and
selected model continue running.

Responses are ordinary streamed text. The server logs Ollama's completion
reason, and the browser displays text as it arrives. Stable assistant behavior
lives in the Modelfile.
