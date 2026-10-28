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
      "The map could not load. Try Map again or use List to browse polls.";
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
      "This browser cannot display the map. Please use List view.",
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
      link.href = `/vote/${p.id}`;
      link.className = "map-poll-link";
      const title = document.createElement("strong");
      title.textContent = p.title;
      const detail = document.createElement("span");
      detail.textContent = `${p.status === "open" ? "Open" : "Ended"} · ${p.totalVotes} votes · View poll ↗`;
      link.append(title, detail);
      content.append(link);
    }
    const note = document.createElement("p");
    note.textContent = "Approximate area, not an exact address.";
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
      "Select a dot to open a poll. Select a numbered group to explore.";
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
