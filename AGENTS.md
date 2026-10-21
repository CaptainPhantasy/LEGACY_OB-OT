# The book's source of truth

Read `dist/content/book.json` and the chapter files it lists before changing this project. Chapter One is `dist/content/oath.txt`, Douglas's complete "What Software Owes You" oath. Keep its wording unchanged. Its promises also guide work on this experience: welcome beginners, explain choices and outcomes, preserve visitors' place, and make every path accessible.

Only Douglas supplies the book's truths. The cellar's atmospheric copy and external curiosities are fiction and discovery aids, not additional doctrine. Never manufacture a new chapter or attribute an assistant-written principle to Douglas.

To add an author-supplied chapter, run `node scripts/add-chapter.mjs /absolute/path/to/chapter.txt "Chapter title"`. The source should be plain Markdown with a `#` title and `##` or `###` section headings. The command preserves its exact bytes, creates the next numbered chapter, updates the manifest and the agent-readable index, and refuses to overwrite existing content. The browser reader loads the manifest, so no reader code change is needed. Review the new chapter and publish through the existing Sites workflow.

Keep the entrance ordinary and the book's identity concealed until the visitor chooses it. Other objects must lead to genuine optional discoveries. All site asset paths must remain relative so the experience can later live in a hidden subdirectory of the main website. Keep the existing Site private unless Douglas requests a different audience.
