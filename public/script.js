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
    $("meta").textContent = `${data.platform} | ${data.uploader || ""} | ${formatDuration(data.duration)}`;
    $("result").classList.remove("hidden");
  } catch (err) {
    $("error").textContent = "Erreur : " + err.message;
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
    const progressBox = $("progressBox");
    const fill = $("progressFill");
    const percentEl = $("progressPercent");
    const speedEl = $("progressSpeed");
    const etaEl = $("progressEta");

    status.classList.add("hidden");
    progressBox.classList.remove("hidden");
    fill.style.width = "0%";
    percentEl.textContent = "0%";
    speedEl.textContent = "";
    etaEl.textContent = "";

    document.querySelectorAll(".formats button").forEach((b) => (b.disabled = true));

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: currentUrl, format }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const evtSource = new EventSource(`/api/progress/${data.jobId}`);

      evtSource.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "progress") {
          fill.style.width = msg.percent + "%";
          percentEl.textContent = msg.percent.toFixed(1) + "%";
          speedEl.textContent = msg.speed ? "Vitesse " + msg.speed : "";
          etaEl.textContent = msg.eta ? "ETA " + msg.eta : "";
        } else if (msg.type === "done") {
          fill.style.width = "100%";
          percentEl.textContent = "100%";
          speedEl.textContent = "";
          etaEl.textContent = "";
          evtSource.close();

          status.className = "success";
          status.innerHTML = `Pret ! <a href="${msg.downloadUrl}" download>Telecharger le fichier</a>`;
          status.classList.remove("hidden");
          progressBox.classList.add("hidden");
          document.querySelectorAll(".formats button").forEach((b) => (b.disabled = false));
        } else if (msg.type === "error") {
          evtSource.close();
          status.className = "error";
          status.textContent = "Erreur : " + msg.message;
          status.classList.remove("hidden");
          progressBox.classList.add("hidden");
          document.querySelectorAll(".formats button").forEach((b) => (b.disabled = false));
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        status.className = "error";
        status.textContent = "Connexion perdue avec le serveur";
        status.classList.remove("hidden");
        progressBox.classList.add("hidden");
        document.querySelectorAll(".formats button").forEach((b) => (b.disabled = false));
      };
    } catch (err) {
      status.className = "error";
      status.textContent = "Erreur : " + err.message;
      status.classList.remove("hidden");
      progressBox.classList.add("hidden");
      document.querySelectorAll(".formats button").forEach((b) => (b.disabled = false));
    }
  });
});

function formatDuration(sec) {
  if (!sec) return "?";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
