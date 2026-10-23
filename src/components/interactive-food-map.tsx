"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Restaurant } from "@/types/database";

const JAPAN_BOUNDS: LatLngBoundsExpression = [[24.0, 122.5], [46.2, 146.5]];

export default function InteractiveFoodMap({
  restaurants,
  selectedRestaurants,
  onOpen,
}: {
  restaurants: Restaurant[];
  selectedRestaurants: Restaurant[];
  onOpen: (restaurant: Restaurant) => void;
}) {
  const located = restaurants.filter(hasCoordinates);
  const selectedLocated = selectedRestaurants.filter(hasCoordinates);

  return (
    <MapContainer
      aria-label="訪問した店舗の位置を表示する拡大可能な日本地図"
      bounds={JAPAN_BOUNDS}
      className="h-[480px] w-full sm:h-[590px]"
      doubleClickZoom
      dragging
      maxBounds={[[18, 118], [50, 150]]}
      minZoom={4}
      scrollWheelZoom
      touchZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapViewport restaurants={selectedLocated.length ? selectedLocated : located} selected={selectedLocated.length > 0} />
      {located.map((restaurant) => (
        <CircleMarker
          key={restaurant.id}
          center={[restaurant.latitude, restaurant.longitude]}
          eventHandlers={{ click: () => onOpen(restaurant) }}
          pathOptions={{
            color: "#ffffff",
            fillColor: selectedLocated.includes(restaurant) ? "#b86647" : "#2f6d57",
            fillOpacity: 0.94,
            opacity: 1,
            weight: 3,
          }}
          radius={selectedLocated.includes(restaurant) ? 9 : 7}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.96}>
            <span className="font-bold">{restaurant.name}</span>
            {restaurant.area && <><br /><span>{restaurant.area}</span></>}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function MapViewport({ restaurants, selected }: { restaurants: LocatedRestaurant[]; selected: boolean }) {
  const map = useMap();
  const coordinates = useMemo(() => restaurants.map((restaurant) => [restaurant.latitude, restaurant.longitude] as [number, number]), [restaurants]);

  useEffect(() => {
    if (!coordinates.length) {
      map.fitBounds(JAPAN_BOUNDS, { animate: true, padding: [12, 12] });
      return;
    }
    if (coordinates.length === 1) {
      map.setView(coordinates[0], selected ? 14 : 10, { animate: true });
      return;
    }
    map.fitBounds(coordinates, { animate: true, maxZoom: selected ? 13 : 10, padding: [36, 36] });
  }, [coordinates, map, selected]);

  return null;
}

type LocatedRestaurant = Restaurant & { latitude: number; longitude: number };

function hasCoordinates(restaurant: Restaurant): restaurant is LocatedRestaurant {
  return typeof restaurant.latitude === "number" && typeof restaurant.longitude === "number";
}
