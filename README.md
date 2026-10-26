<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="design/brand/logo/butler-app-icon.svg">
  <img alt="Butler 2.0" src="design/brand/logo/butler-primary.svg" height="96">
</picture>

<h3>Your own butler, on every screen you own.</h3>

<p>Save anything from any app. Butler organizes it, remembers it, and lives as a little pet on your phone and laptop that can talk to each other.<br>Self-hosted: your data stays on a server you control.</p>

<p>
  <a href="https://github.com/Anasabubakar/Butler-2.0/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Anasabubakar/Butler-2.0/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white"></a>
  <a href="https://github.com/Anasabubakar/Butler-2.0/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Anasabubakar/Butler-2.0?style=for-the-badge&color=6D28D9&logo=github"></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-to_be_decided-lightgrey?style=for-the-badge"></a>
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-16A34A?style=for-the-badge"></a>
</p>

<p>
  <img alt="Android" src="https://img.shields.io/badge/Android-3DDC84?style=flat-square&logo=android&logoColor=white">
  <img alt="Linux GNOME" src="https://img.shields.io/badge/Linux_(GNOME)-4A86CF?style=flat-square&logo=gnome&logoColor=white">
  <img alt="Web" src="https://img.shields.io/badge/Web-111827?style=flat-square&logo=googlechrome&logoColor=white">
  <img alt="Deno" src="https://img.shields.io/badge/Deno-000000?style=flat-square&logo=deno&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-ready-6D28D9?style=flat-square">
</p>

<p>
  <a href="#-quick-start"><b>Quick start</b></a> ·
  <a href="#-features"><b>Features</b></a> ·
  <a href="#-screenshots"><b>Screenshots</b></a> ·
  <a href="docs/self-hosting.md"><b>Self-hosting guide</b></a> ·
  <a href="#-roadmap"><b>Roadmap</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<img src="docs/images/little-butler.png" alt="Little Butler idling, thinking, working and finishing a task" width="560">

<br><br>

<img src="docs/images/home-light.png" alt="Butler's home screen: greeting, Ask Butler box, recent saves, inbox, collections, automations and devices" width="100%">

</div>

---

## 🔥 News

- **[2026-10-26]** **v0.2.0**, the first tagged release: a native Android app that works offline, a new Bento-style website in light and dark, collections named by real topic, and Butler's own voice. [Release notes →](CHANGELOG.md#v020-2026-10-26)
- **[2026-10-23]** **Connections, recipes and automations.** Plug in any MCP server (Zapier, Notion, GitHub…), save instructions as recipes, and run them on a schedule, on new email, or from a webhook. 🧩
- **[2026-10-22]** **Control your laptop from your phone**, clipboard history, and AI that falls back across Gemini, OpenRouter, Groq and OpenAI. 💻
- **[2026-10-20]** Butler 2.0 begins: save from any app, the Little Butler pet on Android and GNOME, morning brief, price watch, clipboard sync and more. 🚀

## ✨ What is Butler?

Most "save for later" apps are a pile you never open again. Butler is different in three ways:

1. **It does the sorting.** Share a TikTok, a GitHub repo, a screenshot or a recipe link and Butler reads it, writes a title and summary, and files it under what it is actually about. Search by meaning, not just by words, or just ask: *"what was that jollof recipe I saved?"*
2. **It lives on your devices.** Little Butler peeks from the edge of your phone and laptop screens. Tap it to save, copy, analyze or translate what you're looking at, send it to your other device, or tell it what to do in plain words.
3. **It's yours.** Butler runs on one small server you own (a free cloud VM works). Your saves, files and accounts never sit in someone else's database.

## 🚀 Features

<table>
<tr>
<td width="50%" valign="top">

### 📥 Save and find
- **Share → Save to Butler** from any Android app, or tap the pet on the laptop
- AI **titles, summaries, tags and topic collections**
- **Search by meaning** and **find similar**
- **Ask your library** questions, with sources
- **Video notes**: key points from YouTube videos
- **Price watch**, **dead-link rescue**, **share a note** by secret link

</td>
<td width="50%" valign="top">

### 🐾 A pet on every screen
- **Little Butler** peeks from the screen edge on Android and GNOME
- **Save, Copy, Analyze, Solve, Translate** whatever is on screen
- **Ask Butler** by typing or talking
- Taps, swipes and types for you, step by step, and **stops before paying, sending or deleting**
- Works **offline** on Android and syncs later

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔁 Devices that talk
- **Send to laptop / phone**: links, text, screenshots, files
- **Clipboard sync** both ways, plus **clipboard history** on the laptop
- **Ring my phone** (even on silent) and ring my laptop
- **Control the laptop from the phone**, with a secret word and a kill switch

</td>
<td width="50%" valign="top">

### ⚡ Automate
- **Connections (MCP)**: Zapier, Notion, GitHub or your own server
- **Recipes** you run by name, **on a schedule**, **on new email**, or **from a webhook**
- Anything that sends, changes or deletes **waits for your yes**
- **Morning brief**, **weekly recap**, reminders, focus timer, spending log
- **Google Calendar, Gmail and Drive backups**

</td>
</tr>
</table>

Every feature, with its settings, is in **[docs/features.md](docs/features.md)**.
