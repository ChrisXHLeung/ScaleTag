import { t } from "/locale.js";
// Loaded only after a visitor chooses Map. Poll data stays on ScaleTag.
const vendor = "/vendor/maplibre/6.16.0/";
const empty = () => ({ type: "FeatureCollection", features: [] });

export async function createPollMap() {
  if (!document.querySelector("#maplibre-css")) {
    const css = document.createElement("link");
    css.id = "maplibre-css";
    css.rel = "stylesheet";
    css.href = vendor + "maplibre-gl.css";
    document.head.append(css);
  }
  const gl = await import(vendor + "maplibre-gl.mjs");
  gl.setWorkerUrl(vendor + "maplibre-gl-worker.mjs");
  gl.setWorkerCount(1);
  const message = document.querySelector("#map-message");
  const host = document.querySelector("#poll-map");
  let map,
    popup,
    rows = [],
    pendingFit = false,
    ready = false;
  const fail = () => {
    message.textContent =
      t("The map could not load. Try Map again or use List to browse posts.", "地图无法加载。请重试或使用列表浏览帖子。");
  };
  try {
    map = new gl.Map({
      container: host,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [0, 20],
      zoom: 1.4,
      maxZoom: 16,
      attributionControl: { compact: false },
      cooperativeGestures: true,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      // A viewport URL/hash would disclose the viewed area in history and links.
      hash: false,
      transformRequest(url) {
        const target = new URL(url, window.location.origin);
        if (
          target.origin !== window.location.origin &&
          target.origin !== "https://tiles.openfreemap.org"
        )
          throw new Error("Unexpected map resource origin");
        return { url: target.href, credentials: "omit" };
      },
    });
  } catch {
    fail();
    throw new Error(
      t("This browser cannot display the map. Please use List view.", "此浏览器无法显示地图，请使用列表视图。"),
    );
  }
  map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
  const timeout = setTimeout(fail, 15000);
  map.on("error", fail);
  const geojson = () => ({
    type: "FeatureCollection",
    features: rows.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p.position },
      properties: { id: p.id, status: p.status },
    })),
  });
  function fit() {
    if (!rows.length) return;
    const bounds = new gl.LngLatBounds();
    rows.forEach((p) => bounds.extend(p.position));
    map.fitBounds(bounds, { padding: 65, maxZoom: 11, duration: 0 });
  }
  function showPolls(coordinates, polls) {
    popup?.remove();
    const content = document.createElement("div");
    content.className = "map-popup-content";
    for (const p of polls) {
      const link = document.createElement("a");
      link.href = `/${p.type === "task" ? "task" : "vote"}/${p.id}`;
      link.className = "map-poll-link";
      const title = document.createElement("strong");
      title.textContent = p.title;
      const detail = document.createElement("span");
      detail.textContent =
        p.type === "task"
          ? t(`Task · Reward: ${p.reward} · View task ↗`, `任务 · 报酬：${p.reward} · 查看任务 ↗`)
          : t(`${p.status === "open" ? "Open" : "Ended"} · ${p.totalVotes} votes · View poll ↗`, `${p.status === "open" ? "进行中" : "已结束"} · ${p.totalVotes} 票 · 查看投票 ↗`);
      link.append(title, detail);
      content.append(link);
    }
    const note = document.createElement("p");
    note.textContent = t("Approximate area, not an exact address.", "这是大致区域，并非精确地址。");
    content.append(note);
    popup = new gl.Popup({ maxWidth: "310px" })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(map);
  }
  map.on("load", () => {
    ready = true;
    clearTimeout(timeout);
    message.textContent =
      t("Select a dot to open a post. Select a numbered group to explore.", "选择圆点打开帖子，选择数字组可展开查看。");
    map.addSource("polls", {
      type: "geojson",
      data: geojson(),
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 45,
    });
    map.addLayer({
      id: "poll-clusters",
      type: "circle",
      source: "polls",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1746a2",
        "circle-radius": ["step", ["get", "point_count"], 20, 10, 25, 100, 31],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
    map.addLayer({
      id: "poll-counts",
      type: "symbol",
      source: "polls",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 13,
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "poll-points",
      type: "circle",
      source: "polls",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "match",
          ["get", "status"],
          "open",
          "#1746a2",
          "#c7283d",
        ],
        "circle-radius": 9,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
    map.on("click", "poll-clusters", async (event) => {
      const feature = event.features[0];
      const source = map.getSource("polls");
      try {
        const zoom = await source.getClusterExpansionZoom(
          feature.properties.cluster_id,
        );
        map.easeTo({
          center: feature.geometry.coordinates,
          zoom: Math.min(zoom, 14),
          duration: 300,
        });
      } catch {
        /* Source may have changed while filtering. */
      }
    });
    // Coarse grid positions can overlap. A click at high zoom offers every poll
    // at that grid point instead of leaving all but the top feature inaccessible.
    map.on("click", "poll-points", (event) => {
      const p = rows.find((p) => p.id === event.features[0].properties.id);
      if (p)
        showPolls(
          p.position,
          rows.filter(
            (other) =>
              other.position[0] === p.position[0] &&
              other.position[1] === p.position[1],
          ),
        );
    });
    for (const layer of ["poll-clusters", "poll-points"]) {
      map.on("mouseenter", layer, () => {
        host.querySelector("canvas").style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        host.querySelector("canvas").style.cursor = "";
      });
    }
    if (pendingFit) fit();
  });
  return {
    setData(polls, shouldFit = false) {
      popup?.remove();
      rows = polls;
      pendingFit = shouldFit;
      if (ready) {
        map.getSource("polls").setData(geojson());
        if (shouldFit) fit();
      }
    },
    resize() {
      map.resize();
    },
    destroy() {
      clearTimeout(timeout);
      popup?.remove();
      map.remove();
    },
  };
}
