const $ = (id) => document.getElementById(id);
let currentUrl = "";

$("btnInfo").addEventListener("click", async () => {
  const url = $("url").value.trim();
  if (!url) return;

  currentUrl = url;
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  $("result").classList.add("hidden");

  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    $("thumb").src = data.thumbnail || "";
    $("title").textContent = data.title;
    $("meta").textContent = `${data.platform} • ${data.uploader || ""} • ${formatDuration(data.duration)}`;
    $("result").classList.remove("hidden");
  } catch (err) {
    $("error").textContent = "❌ " + err.message;
    $("error").classList.remove("hidden");
  } finally {
    $("loading").classList.add("hidden");
  }
});

document.querySelectorAll(".formats button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!currentUrl) return;
    const format = btn.dataset.format;
    const status = $("downloadStatus");
    status.className = "downloading";
    status.textContent = "⏳ Téléchargement en cours... Patientez.";
    status.classList.remove("hidden");
    btn.disabled = true;

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: currentUrl, format }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      status.className = "success";
      status.innerHTML = `✅ Prêt ! <a href="${data.downloadUrl}" download>Télécharger le fichier</a>`;
    } catch (err) {
      status.className = "error";
      status.textContent = "❌ " + err.message;
    } finally {
      btn.disabled = false;
    }
  });
});

function formatDuration(sec) {
  if (!sec) return "?";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
