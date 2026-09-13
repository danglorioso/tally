// ---------- state ----------
const PALETTE = ["#4f8cff", "#3ecf8e", "#ffb020", "#ff6b6b", "#c084fc", "#22d3ee", "#fb923c", "#a3e635"];

let people = []; // {id, name, color}
let items = [];  // {id, code, rawName, name, priceCents, discountCents, assignees:Set<personId>}
let nextPersonId = 1;
let nextItemId = 1;

const DICT_KEY = "receiptSplitter.itemDictionary"; // { code: friendlyName }
function loadDict() {
  try { return JSON.parse(localStorage.getItem(DICT_KEY)) || {}; }
  catch { return {}; }
}
function saveDict(dict) {
  localStorage.setItem(DICT_KEY, JSON.stringify(dict));
}
let itemDict = loadDict();

// ---------- money helpers ----------
function toCents(dollarStr) {
  const n = parseFloat(String(dollarStr).replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}
function fmt(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// Largest-remainder apportionment: split totalCents across weights, summing exactly to totalCents.
function apportion(totalCents, weights) {
  const n = weights.length;
  if (n === 0) return [];
  let sumW = weights.reduce((a, b) => a + b, 0);
  let w = weights;
  if (sumW === 0) {
    if (totalCents === 0) return weights.map(() => 0);
    w = weights.map(() => 1);
    sumW = n;
  }
  const raw = w.map((wi) => (totalCents * wi) / sumW);
  const floors = raw.map(Math.floor);
  let allocated = floors.reduce((a, b) => a + b, 0);
  let remainder = totalCents - allocated;
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  // remainder can be negative if totalCents negative; handle both directions
  const step = remainder >= 0 ? 1 : -1;
  let remaining = Math.abs(remainder);
  let k = 0;
  while (remaining > 0 && k < order.length) {
    result[order[k].i] += step;
    remaining--;
    k++;
  }
  return result;
}

// ---------- people ----------
function capitalizeName(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function addPerson(name) {
  if (!name.trim()) return;
  const color = PALETTE[people.length % PALETTE.length];
  people.push({ id: nextPersonId++, name: capitalizeName(name), color });
  renderPeople();
  renderItems();
  renderResults();
}
function removePerson(id) {
  people = people.filter((p) => p.id !== id);
  items.forEach((it) => it.assignees.delete(id));
  renderPeople();
  renderItems();
  renderResults();
}
function renderPeople() {
  const row = document.getElementById("peopleRow");
  row.innerHTML = "";
  if (people.length === 0) {
    row.innerHTML = `<span class="empty-hint">No people yet — add everyone splitting this receipt.</span>`;
    return;
  }
  people.forEach((p) => {
    const chip = document.createElement("span");
    chip.className = "chip on";
    chip.style.background = p.color;
    chip.innerHTML = `${escapeHtml(p.name)} <span class="x" title="Remove">&times;</span>`;
    chip.querySelector(".x").addEventListener("click", (e) => {
      e.stopPropagation();
      removePerson(p.id);
    });
    row.appendChild(chip);
  });
}

// ---------- items ----------
function addItem(partial = {}) {
  items.push({
    id: nextItemId++,
    code: partial.code || "",
    rawName: partial.rawName || "",
    name: partial.name || "New item",
    priceCents: partial.priceCents || 0,
    discountCents: partial.discountCents || 0,
    taxable: partial.taxable !== undefined ? partial.taxable : true,
    assignees: new Set(partial.assignees || []),
  });
  renderItems();
  renderResults();
}
function removeItem(id) {
  items = items.filter((it) => it.id !== id);
  renderItems();
  renderResults();
}
function toggleAssignee(itemId, personId) {
  const it = items.find((i) => i.id === itemId);
  if (!it) return;
  if (it.assignees.has(personId)) it.assignees.delete(personId);
  else it.assignees.add(personId);
  renderItems();
  renderResults();
}
// Avatar labels: first letter, but disambiguated to two letters when people
// share the same first letter (first-two-letters, falling back to
// first+last-letter, falling back to a numbered suffix for exact duplicates).
function computeAvatarLabels(peopleList) {
  const twoLetterOf = (name) => {
    const n = name.trim();
    return n.length >= 2 ? (n[0] + n[1]).toUpperCase() : n.toUpperCase();
  };
  const firstLastOf = (name) => {
    const n = name.trim();
    return n.length >= 2 ? (n[0] + n[n.length - 1]).toUpperCase() : n.toUpperCase();
  };

  const groups = new Map(); // first letter -> people[]
  peopleList.forEach((p) => {
    const key = p.name.trim().charAt(0).toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  const labels = new Map();
  groups.forEach((group, key) => {
    if (group.length === 1) {
      labels.set(group[0].id, key);
      return;
    }
    const twoLetter = group.map((p) => twoLetterOf(p.name));
    if (new Set(twoLetter).size === group.length) {
      group.forEach((p, i) => labels.set(p.id, twoLetter[i]));
      return;
    }
    const firstLast = group.map((p) => firstLastOf(p.name));
    if (new Set(firstLast).size === group.length) {
      group.forEach((p, i) => labels.set(p.id, firstLast[i]));
      return;
    }
    group.forEach((p, i) => labels.set(p.id, twoLetter[i] + (i + 1)));
  });
  return labels;
}

function toggleAllAssignees(itemId) {
  const it = items.find((i) => i.id === itemId);
  if (!it) return;
  if (it.assignees.size === people.length) it.assignees.clear();
  else it.assignees = new Set(people.map((p) => p.id));
  renderItems();
  renderResults();
}

function renderItems() {
  const body = document.getElementById("itemsBody");
  const emptyHint = document.getElementById("emptyHint");
  body.innerHTML = "";
  emptyHint.style.display = items.length === 0 ? "block" : "none";
  const avatarLabels = computeAvatarLabels(people);

  let unassignedCents = 0;
  let unassignedCount = 0;

  items.forEach((it) => {
    const tr = document.createElement("tr");
    tr.className = "item-row" + (it.assignees.size === 0 ? " unassigned" : "");

    // Item name cell — tooltip only appears when the dictionary has a saved
    // name that differs from what's currently shown (i.e. an actual alternative).
    const tdName = document.createElement("td");
    const known = it.code ? itemDict[it.code] : null;
    const hasAlt = known && known !== it.name;
    tdName.className = "item-name-cell" + (hasAlt ? " has-alt" : "");
    tdName.innerHTML = `
      <input type="text" value="${escapeAttr(it.name)}" data-role="name" />
      ${it.code ? `<span class="code-badge">#${escapeHtml(it.code)}${!known ? ` <a href="https://www.google.com/search?q=Costco+item+${encodeURIComponent(it.code)}" target="_blank" rel="noopener" class="lookup-link">look up ↗</a>` : ""}</span>` : ""}
      ${hasAlt ? `<div class="tooltip">Also known as <b>${escapeHtml(known)}</b></div>` : ""}
    `;
    tdName.querySelector('[data-role="name"]').addEventListener("input", (e) => {
      it.name = e.target.value;
      if (it.code) {
        itemDict[it.code] = it.name;
        saveDict(itemDict);
        renderDict();
      }
      renderResults();
    });
    tr.appendChild(tdName);

    // price
    const tdPrice = document.createElement("td");
    tdPrice.className = "num";
    tdPrice.innerHTML = `<input type="number" step="0.01" value="${(it.priceCents / 100).toFixed(2)}" data-role="price" />`;
    tdPrice.querySelector("input").addEventListener("input", (e) => {
      it.priceCents = toCents(e.target.value);
      renderResults();
      updateTotalsDisplay();
    });
    tr.appendChild(tdPrice);

    // discount
    const tdDisc = document.createElement("td");
    tdDisc.className = "num";
    tdDisc.innerHTML = `<input type="number" step="0.01" value="${(it.discountCents / 100).toFixed(2)}" data-role="discount" />`;
    tdDisc.querySelector("input").addEventListener("input", (e) => {
      it.discountCents = toCents(e.target.value);
      renderResults();
      updateTotalsDisplay();
    });
    tr.appendChild(tdDisc);

    // taxable
    const tdTax = document.createElement("td");
    tdTax.style.textAlign = "center";
    tdTax.innerHTML = `<input type="checkbox" data-role="taxable" ${it.taxable ? "checked" : ""} title="Taxable item — tax is split only among taxable items" />`;
    tdTax.querySelector("input").addEventListener("change", (e) => {
      it.taxable = e.target.checked;
      renderResults();
    });
    tr.appendChild(tdTax);

    // assignees
    const tdAssign = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row";
    if (people.length === 0) {
      wrap.innerHTML = `<span class="empty-hint">Add people first</span>`;
    } else {
      const allOn = it.assignees.size === people.length;
      const allBtn = document.createElement("span");
      allBtn.className = "avatar-toggle all" + (allOn ? " on" : "");
      allBtn.textContent = "ALL";
      allBtn.title = "Everyone";
      allBtn.addEventListener("click", () => toggleAllAssignees(it.id));
      wrap.appendChild(allBtn);

      people.forEach((p) => {
        const on = it.assignees.has(p.id);
        const label = avatarLabels.get(p.id);
        const av = document.createElement("span");
        av.className = "avatar-toggle" + (on ? " on" : "") + (label.length > 1 ? " wide" : "");
        if (on) av.style.background = p.color;
        av.textContent = label;
        av.title = p.name;
        av.addEventListener("click", () => toggleAssignee(it.id, p.id));
        wrap.appendChild(av);
      });
    }
    tdAssign.appendChild(wrap);
    tr.appendChild(tdAssign);

    // actions
    const tdAct = document.createElement("td");
    tdAct.innerHTML = `<button class="small-btn danger" data-role="del">Delete</button>`;
    tdAct.querySelector("button").addEventListener("click", () => removeItem(it.id));
    tr.appendChild(tdAct);

    body.appendChild(tr);

    if (it.assignees.size === 0) {
      unassignedCount++;
      unassignedCents += it.priceCents - it.discountCents;
    }
  });

  const warnEl = document.getElementById("unassignedWarn");
  if (unassignedCount > 0) {
    warnEl.innerHTML = `<div class="warn-banner">${unassignedCount} item${unassignedCount > 1 ? "s" : ""} not assigned to anyone (${fmt(unassignedCents)}) — pick who's splitting them or the totals below won't balance.</div>`;
  } else {
    warnEl.innerHTML = "";
  }

  renderDict();
  updateTotalsDisplay();
}

function renderDict() {
  const el = document.getElementById("dictTable");
  const entries = Object.entries(itemDict);
  if (entries.length === 0) {
    el.innerHTML = `<div class="empty-hint">No saved item names yet. Rename a line item with an item code and it's remembered here for next time.</div>`;
    return;
  }
  let html = `<table><thead><tr><th>Code</th><th>Saved name</th><th></th></tr></thead><tbody>`;
  entries.sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, name]) => {
    html += `<tr><td>${escapeHtml(code)}</td><td>${escapeHtml(name)}</td><td><button class="small-btn danger" data-code="${escapeAttr(code)}">Forget</button></td></tr>`;
  });
  html += `</tbody></table>`;
  el.innerHTML = html;
  el.querySelectorAll("button[data-code]").forEach((btn) => {
    btn.addEventListener("click", () => {
      delete itemDict[btn.dataset.code];
      saveDict(itemDict);
      renderDict();
    });
  });
}

// ---------- totals + split calc ----------
function updateTotalsDisplay() {
  const subtotalCents = items.reduce((s, it) => s + (it.priceCents - it.discountCents), 0);
  document.getElementById("computedSubtotal").textContent = fmt(subtotalCents);
  const taxCents = toCents(document.getElementById("taxInput").value);
  const totalCents = subtotalCents + taxCents;
  document.getElementById("computedTotal").textContent = fmt(totalCents);

  const printedVal = document.getElementById("printedTotalInput").value;
  const checkEl = document.getElementById("totalCheck");
  if (printedVal !== "") {
    const printedCents = toCents(printedVal);
    if (printedCents === totalCents) {
      checkEl.innerHTML = `<div class="balance-check ok">Matches receipt's printed total ✓</div>`;
    } else {
      checkEl.innerHTML = `<div class="balance-check bad">Off by ${fmt(Math.abs(printedCents - totalCents))} from receipt's printed total — check items/discounts/tax.</div>`;
    }
  } else {
    checkEl.innerHTML = "";
  }
  updateStickyBar();
}

// Shared by renderResults() and updateStickyBar() so both surfaces always agree.
// Tax is tracked against taxable-only subtotals since tax is only owed on
// taxable items (matches the Y/N flag Costco prints per line).
function computeSplit() {
  const personSubtotal = new Map(people.map((p) => [p.id, 0]));
  const personTaxableSubtotal = new Map(people.map((p) => [p.id, 0]));
  items.forEach((it) => {
    const netCents = it.priceCents - it.discountCents;
    const assigneeIds = [...it.assignees];
    if (assigneeIds.length === 0) return;
    const weights = assigneeIds.map(() => 1);
    const shares = apportion(netCents, weights);
    assigneeIds.forEach((pid, i) => {
      personSubtotal.set(pid, personSubtotal.get(pid) + shares[i]);
      if (it.taxable) {
        personTaxableSubtotal.set(pid, personTaxableSubtotal.get(pid) + shares[i]);
      }
    });
  });

  const subtotalCents = items.reduce((s, it) => s + (it.priceCents - it.discountCents), 0);
  const taxCents = toCents(document.getElementById("taxInput").value);
  const totalSubtotalAllocated = [...personSubtotal.values()].reduce((a, b) => a + b, 0);
  const weightsForTax = people.map((p) => personTaxableSubtotal.get(p.id));
  const taxShares = apportion(taxCents, weightsForTax);

  let grandTotal = 0;
  const perPerson = people.map((p, i) => {
    const sub = personSubtotal.get(p.id);
    const tax = taxShares[i];
    const total = sub + tax;
    grandTotal += total;
    return { id: p.id, name: p.name, color: p.color, sub, tax, total };
  });

  return {
    subtotalCents,
    taxCents,
    expectedTotal: subtotalCents + taxCents,
    unassignedNet: subtotalCents - totalSubtotalAllocated,
    grandTotal,
    perPerson,
  };
}

function updateStickyBar() {
  const bar = document.getElementById("stickyBar");
  if (!bar) return;
  if (items.length === 0 && people.length === 0) {
    bar.classList.remove("show");
    return;
  }
  bar.classList.add("show");

  const split = computeSplit();
  document.getElementById("sbAmt").textContent = fmt(split.expectedTotal);

  const peopleEl = document.getElementById("sbPeople");
  peopleEl.innerHTML = split.perPerson
    .map(
      (p) =>
        `<span class="sb-person"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)} <b>${fmt(p.total)}</b></span>`
    )
    .join("");

  const statusEl = document.getElementById("sbStatus");
  const unassigned = items.some((it) => it.assignees.size === 0) || items.length === 0;
  if (people.length === 0) {
    statusEl.textContent = "Add people";
    statusEl.className = "sb-status bad";
  } else if (unassigned) {
    statusEl.textContent = "Unassigned items";
    statusEl.className = "sb-status bad";
  } else {
    statusEl.textContent = "Balanced ✓";
    statusEl.className = "sb-status ok";
  }
}

function renderResults() {
  const resultsEl = document.getElementById("results");
  const balanceEl = document.getElementById("balanceCheck");
  resultsEl.innerHTML = "";

  if (people.length === 0) {
    resultsEl.innerHTML = `<span class="empty-hint">Add people to see who owes what.</span>`;
    balanceEl.innerHTML = "";
    return;
  }

  const split = computeSplit();
  split.perPerson.forEach((p) => {
    const card = document.createElement("div");
    card.className = "person-card";
    card.innerHTML = `
      <div>
        <div class="name"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>
        <div class="sub">${fmt(p.sub)} items + ${fmt(p.tax)} tax</div>
      </div>
      <div class="amt">${fmt(p.total)}</div>
    `;
    resultsEl.appendChild(card);
  });

  if (split.unassignedNet !== 0) {
    balanceEl.innerHTML = `<div class="balance-check bad">${fmt(split.unassignedNet)} in items isn't assigned to anyone yet — totals below exclude it.</div>`;
  } else if (split.grandTotal === split.expectedTotal) {
    balanceEl.innerHTML = `<div class="balance-check ok"><span>Sum of everyone's total</span><b>${fmt(split.grandTotal)}</b></div><div class="balance-check ok" style="margin-top:6px">Matches receipt total exactly ✓</div>`;
  } else {
    balanceEl.innerHTML = `<div class="balance-check bad">Sum ${fmt(split.grandTotal)} ≠ receipt total ${fmt(split.expectedTotal)} — this shouldn't happen, please report.</div>`;
  }
}

// ---------- OCR / PDF ----------
let uploadedFile = null;

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function handleFile(file) {
  uploadedFile = file || null;
  const preview = document.getElementById("preview");
  const scanBtn = document.getElementById("scanBtn");
  const dzFilename = document.getElementById("dzFilename");
  const dzTitle = document.getElementById("dzTitle");

  if (!uploadedFile) {
    preview.style.display = "none";
    scanBtn.disabled = true;
    dzFilename.style.display = "none";
    document.getElementById("ocrDetails").style.display = "none";
    return;
  }

  dzTitle.textContent = "Looks good — scanning...";
  dzFilename.textContent = uploadedFile.name;
  dzFilename.style.display = "block";
  scanBtn.disabled = false;
  scanBtn.textContent = isPdf(uploadedFile) ? "Re-extract items" : "Re-scan with OCR";
  document.getElementById("ocrDetails").style.display = "block";

  runScan().then(() => {
    dzTitle.textContent = "Looks good — scanned";
  });

  if (isPdf(uploadedFile)) {
    preview.style.display = "none";
    renderPdfPreview(uploadedFile).catch(() => {});
  } else {
    preview.src = URL.createObjectURL(uploadedFile);
    preview.style.display = "block";
  }
}

async function renderPdfPreview(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const preview = document.getElementById("preview");
  preview.src = canvas.toDataURL("image/png");
  preview.style.display = "block";
}

// Reconstruct line-based text from a PDF's real text layer (accurate, no OCR needed
// since Costco digital receipts are text PDFs, not scans).
function groupTextItemsIntoLines(textItems) {
  const lines = [];
  const tolerance = 2.5;
  textItems.forEach((it) => {
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < tolerance);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  });
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) =>
      l.items
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((it) => it.str)
        .join(" ")
    )
    .join("\n");
}

async function extractPdfText(file, progressEl) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let allText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    progressEl.textContent = `Reading page ${i} of ${pdf.numPages}...`;
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    allText += groupTextItemsIntoLines(content.items) + "\n";
  }
  return allText;
}

const dropzone = document.getElementById("dropzone");
document.getElementById("fileInput").addEventListener("change", (e) => {
  handleFile(e.target.files[0]);
});
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  document.getElementById("fileInput").files = e.dataTransfer.files;
  handleFile(file);
});

async function runScan() {
  if (!uploadedFile) return;
  const progressEl = document.getElementById("ocrProgress");
  const scanBtn = document.getElementById("scanBtn");
  scanBtn.disabled = true;
  try {
    let text;
    if (isPdf(uploadedFile)) {
      progressEl.textContent = "Reading PDF text layer...";
      text = await extractPdfText(uploadedFile, progressEl);
      if (text.replace(/\s/g, "").length < 20) {
        progressEl.textContent = "No text layer found, falling back to OCR on rendered page...";
        const buf = await uploadedFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const result = await Tesseract.recognize(canvas, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text") progressEl.textContent = `Scanning... ${Math.round(m.progress * 100)}%`;
          },
        });
        text = result.data.text;
      }
    } else {
      progressEl.textContent = "Loading OCR engine...";
      const result = await Tesseract.recognize(uploadedFile, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            progressEl.textContent = `Scanning... ${Math.round(m.progress * 100)}%`;
          } else {
            progressEl.textContent = m.status;
          }
        },
      });
      text = result.data.text;
    }
    document.getElementById("rawText").value = text;
    progressEl.textContent = "Done. Review detected items below.";
    parseReceiptText(text);
  } catch (err) {
    progressEl.textContent = "Scan failed: " + err.message;
  } finally {
    scanBtn.disabled = false;
  }
}

document.getElementById("scanBtn").addEventListener("click", runScan);

document.getElementById("parseBtn").addEventListener("click", () => {
  parseReceiptText(document.getElementById("rawText").value);
});

// Best-effort receipt line parser (Costco-style: "E CODE NAME ... PRICE Y/N",
// discount lines "TXNCODE / ITEMCODE PRICE-")
function parseReceiptText(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // amount at end of line, either -1.23 or 1.23- (Costco uses trailing minus for
  // discounts), optionally followed by a taxable flag letter (Y/N)
  const priceRe = /(-)?\$?(\d{1,3}(?:,\d{3})*\.\d{2})(-)?\s*([A-Z])?\s*$/;
  const codeRe = /^(\d{3,7})\s*\/?\s*(.*)$/;
  const noiseRe = /^(member|aid|xxxx|change|cash|debit|credit|visa|mastercard|discover|amex|chip|approved|purchase|auth|items sold|instant sav|amount|thank you|please come|whse|trm:|total number)/i;
  const taxSummaryLineRe = /^\(?[a-z]\)?\s*[a-z]\s+[\d.]+-?$/i; // e.g. "(A) A 4.94"

  let parsedItems = [];
  let lastItem = null;

  for (const rawLine of lines) {
    const m = rawLine.match(priceRe);
    if (!m) continue;
    const isNegative = !!m[1] || !!m[3];
    const priceCents = toCents(m[2]) * (isNegative ? -1 : 1);
    const taxFlag = m[4];
    let rest = rawLine.slice(0, m.index).trim();

    // strip leading punctuation (e.g. "****") before classifying the line
    const cleaned = rawLine.toLowerCase().replace(/^[^a-z0-9]+/, "").trim();

    if (/^subtotal\b/.test(cleaned)) continue;
    if (/^total\s*tax\b/.test(cleaned)) continue; // duplicate tax summary line, not the grand total
    if (taxSummaryLineRe.test(rawLine)) continue; // e.g. "(A) A 4.94" tax-category summary
    if (/^tax\b/.test(cleaned)) {
      document.getElementById("taxInput").value = (Math.abs(priceCents) / 100).toFixed(2);
      continue;
    }
    if (/^total\b/.test(cleaned)) {
      document.getElementById("printedTotalInput").value = (Math.abs(priceCents) / 100).toFixed(2);
      continue;
    }
    if (noiseRe.test(cleaned)) continue;

    // discount line: negative amount, usually "TXNCODE / ITEMCODE 3.15-"
    if (isNegative) {
      if (!lastItem) continue;
      const slashMatch = rest.match(/\/\s*(\d{3,7})\s*$/);
      let target = lastItem;
      if (slashMatch) {
        const found = parsedItems.find((p) => p.code === slashMatch[1]);
        if (found) target = found;
      }
      target.discountCents += Math.abs(priceCents);
      continue;
    }

    if (priceCents <= 0) continue;

    // strip a leading single-letter eligibility flag, e.g. "E 1357312 FRESH STACKS"
    rest = rest.replace(/^[A-Z]\s+(?=\d)/, "");

    const cm = rest.match(codeRe);
    let code = "";
    let name = rest;
    if (cm) {
      code = cm[1];
      name = cm[2].trim() || rest;
    }
    name = name.replace(/^\*+|\*+$/g, "").replace(/\s+/g, " ").trim();

    const known = code && itemDict[code];
    const newItem = {
      code,
      rawName: rest,
      name: known || name || "Item",
      priceCents,
      discountCents: 0,
      taxable: taxFlag ? taxFlag.toUpperCase() === "Y" : true,
      assignees: [],
    };
    parsedItems.push(newItem);
    lastItem = newItem;
  }

  if (parsedItems.length === 0) {
    alert("Couldn't auto-detect any line items from that text. Add items manually below, or edit the raw OCR text and try again.");
    return;
  }

  parsedItems.forEach((pi) => addItem(pi));
}

// ---------- add buttons ----------
document.getElementById("addPersonBtn").addEventListener("click", () => {
  const input = document.getElementById("newPersonName");
  addPerson(input.value);
  input.value = "";
});
document.getElementById("newPersonName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addPersonBtn").click();
});
document.getElementById("addItemBtn").addEventListener("click", () => addItem());
document.getElementById("taxInput").addEventListener("input", () => {
  updateTotalsDisplay();
  renderResults();
});
document.getElementById("printedTotalInput").addEventListener("input", updateTotalsDisplay);

// ---------- utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ---------- init ----------
renderPeople();
renderItems();
renderResults();
