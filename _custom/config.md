# Configuring the Obsidian plug-in

Output path:
zotero/notes/{{citekey}}.md

zotero/notes/{% if collections and collections.length %}{{ (collections | sort(false, false, "fullPath") | first).fullPath }}{% else %}_Unfiled{% endif %}/@{{citekey}}.md

Image output path:
zotero/images/{{citekey}}/

zotero/images/{% if collections and collections.length %}{{ (collections | sort(false, false, "fullPath") | first).fullPath }}{% else %}_Unfiled{% endif %}/{{citekey}}/


