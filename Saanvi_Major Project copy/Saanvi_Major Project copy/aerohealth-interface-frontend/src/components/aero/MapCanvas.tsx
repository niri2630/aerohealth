import "leaflet/dist/leaflet.css";

import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { LatLngBounds } from "leaflet";
import { useEffect } from "react";

import { routesCoincide } from "@/lib/aero/route-metrics";
import type { LatLon, RouteComparison } from "@/lib/aero/types";

function Recenter({ loc, routes }: { loc: LatLon; routes?: RouteComparison | undefined }) {
  const map = useMap();
  useEffect(() => {
    const routeCoordinates = [
      ...((routes?.direct_route.geojson as { coordinates?: [number, number][] })?.coordinates ??
        []),
      ...((routes?.safe_route.geojson as { coordinates?: [number, number][] })?.coordinates ?? []),
    ];

    if (routeCoordinates.length > 1) {
      const bounds = new LatLngBounds(
        routeCoordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 15, duration: 1.2 });
      return;
    }

    map.flyTo([loc.lat, loc.lon], 12, { duration: 1.2 });
  }, [loc.lat, loc.lon, map, routes]);
  return null;
}

function toLatLngs(geo: RouteComparison["safe_route"]["geojson"]) {
  const coords = (geo as { coordinates?: [number, number][] })?.coordinates ?? [];
  return coords.map(([lon, lat]) => [lat, lon] as [number, number]);
}

export default function MapCanvas({
  loc,
  aqi,
  routes,
}: {
  loc: LatLon;
  aqi: number;
  routes?: RouteComparison | undefined;
}) {
  const cells = Array.from({ length: 26 }).map((_, i) => {
    const angle = i * 2.4;
    const radius = 0.012 + (i % 6) * 0.011;
    return {
      lat: loc.lat + Math.sin(angle) * radius,
      lon: loc.lon + Math.cos(angle) * radius * 1.6,
      w: 0.035 + ((Math.sin(i * 1.7) + 1) / 2) * 0.09 * (aqi / 160),
      r: 16 + (i % 5) * 8,
    };
  });

  return (
    <MapContainer
      center={[loc.lat, loc.lon]}
      zoom={12}
      zoomControl={false}
      scrollWheelZoom={false}
      className="h-full w-full"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      <Recenter loc={loc} routes={routes} />

      {cells.map((c, i) => (
        <CircleMarker
          key={i}
          center={[c.lat, c.lon]}
          radius={c.r}
          pathOptions={{
            stroke: false,
            fillColor: "var(--primary)",
            fillOpacity: c.w,
          }}
        />
      ))}

      <CircleMarker
        center={[loc.lat, loc.lon]}
        radius={22}
        pathOptions={{ stroke: false, fillColor: "var(--primary)", fillOpacity: 0.14 }}
        className="animate-pulse"
      />
      <CircleMarker
        center={[loc.lat, loc.lon]}
        radius={5}
        pathOptions={{
          color: "var(--primary)",
          weight: 2,
          fillColor: "var(--primary)",
          fillOpacity: 1,
        }}
      />

      {routes ? (
        <>
          <Polyline
            positions={toLatLngs(routes.direct_route.geojson)}
            pathOptions={{
              color: "#ef4444",
              weight: 4,
              opacity: 0.95,
            }}
          />
          <Polyline
            positions={toLatLngs(routes.safe_route.geojson)}
            pathOptions={{
              color: "#f8fafc",
              weight: 8,
              opacity: 0.7,
            }}
          />
          <Polyline
            positions={toLatLngs(routes.safe_route.geojson)}
            pathOptions={{
              color: "var(--primary)",
              weight: 5,
              opacity: 1,
              className: "route-draw",
            }}
          />
          {routesCoincide(routes) ? (
            // Same road: draw the direct route as red dashes on top so both are visible.
            <Polyline
              positions={toLatLngs(routes.direct_route.geojson)}
              pathOptions={{
                color: "#ef4444",
                weight: 3,
                opacity: 1,
                dashArray: "2 10",
                lineCap: "round",
              }}
            />
          ) : null}
        </>
      ) : null}
    </MapContainer>
  );
}
