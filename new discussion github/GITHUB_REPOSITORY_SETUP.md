# GitHub Repository Setup for New Discussion Files

## Important

Create this repository as **Private**.

The project contains internal business files, POS code, product data, SQL files, and cost-related import files. Do not make it public unless you intentionally want those files visible.

---

## Recommended repository name

```text
benamor-ai-handover
```

or:

```text
benamor-project-current
```

---

## Option A — Upload by GitHub website

1. Open GitHub:

```text
https://github.com/
```

2. Click:

```text
New repository
```

3. Repository name:

```text
benamor-ai-handover
```

4. Visibility:

```text
Private
```

5. Do not add README if you will upload the existing files.

6. Click:

```text
Create repository
```

7. Open the repository page.

8. Click:

```text
Add file → Upload files
```

9. Drag the contents of the folder:

```text
new discussion/
```

into the GitHub upload page.

10. Commit message:

```text
Initial project handover files
```

11. Click:

```text
Commit changes
```

---

## Option B — Upload using Git commands

Use this if you have Git installed.

Open terminal / Git Bash inside the folder that contains `new discussion`, then run:

```bash
cd "new discussion"
git init
git add .
git commit -m "Initial project handover files"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/benamor-ai-handover.git
git push -u origin main
```

Replace:

```text
YOUR_USERNAME
```

with your GitHub username or organization name.

Example:

```bash
git remote add origin https://github.com/bunomargroup-sketch/benamor-ai-handover.git
```

---

## Files the new AI should read first

After uploading, in the new chat tell the AI:

```text
Read these files first:

1. PROJECT_HANDOVER_DETAILED.md
2. NEW_CHAT_PROMPT.md
3. AI_WORKING_INSTRUCTIONS_FOR_THIS_USER.md
```

Then continue from the latest task.

---

## Suggested first prompt for the new chat

```text
I uploaded a GitHub repository with the current project files.
Please read PROJECT_HANDOVER_DETAILED.md, NEW_CHAT_PROMPT.md, and AI_WORKING_INSTRUCTIONS_FOR_THIS_USER.md first.
Do not start coding until you understand the project structure and current state.
```
