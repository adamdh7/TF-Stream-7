// script.js const chat = document.getElementById("chat"); const msgInput = document.getElementById("msgInput"); const imgInput = document.getElementById("imgInput");

const username = "user-" + Math.floor(Math.random() * 1000000);

function addMsg(txt, isUser = true) { const div = document.createElement("div"); div.className = "msg " + (isUser ? "user" : "ai"); div.textContent = txt; chat.appendChild(div); chat.scrollTop = chat.scrollHeight; }

async function sendMsg() { const txt = msgInput.value.trim(); const img = imgInput.files[0];

if (!txt && !img) return;

addMsg(txt || "[Imaj voye...]", true); msgInput.value = ""; imgInput.value = "";

let base64 = ""; if (img) base64 = await toBase64(img);

const res = await fetch("/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: username, message: txt, image: base64 }) });

const data = await res.json(); addMsg(data.response, false); }

function toBase64(file) { return new Promise((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result.split(",")[1]); reader.onerror = rej; reader.readAsDataURL(file); }); }


