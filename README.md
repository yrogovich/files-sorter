# Downloads Sorter

Sorts the loose files in your Downloads folder into `Images`, `Documents`, `Archives`, … with an animation: the mess sits in the middle, click it and every file flies into its folder.

```bash
npm start                       # sorts ~/Downloads, opens http://localhost:4827
node server.js --dir ~/Desktop  # any other folder
```

- **Undo last sort** puts everything back. Files are never overwritten (`a (1).jpg` on a clash).
- **Keep sorted automatically** files away new downloads every 10 s once they are 10 s old (so unfinished downloads are left alone).
- Hidden files, partial downloads (`.crdownload`, `.part`…) and existing sub-folders are never touched.
- Custom rules: create `~/.file-sorter/rules.json` like `{"Books": ["epub","pdf"], "Photos": ["jpg","png"]}`; unmatched files go to `Other`.
- Flags: `--port`, `--data` (history/config dir, default `~/.file-sorter`), `--no-open`.

No dependencies, Node 18+. The server only listens on localhost and rejects foreign origins.
