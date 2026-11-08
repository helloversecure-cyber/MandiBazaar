import { describe, expect, it } from "vitest";
import {
  extractCoordsFromMapsUrl,
  isGoogleMapsHost,
  isShortMapsLink,
  resolveMapsUrlCoords,
} from "@/lib/geo/maps-url";

describe("extractCoordsFromMapsUrl", () => {
  it("prefers the !3d!4d place pin over the @ viewport", () => {
    const url =
      "https://www.google.com/maps/place/Liberty+Market/@31.5100,74.3400,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d31.5204!4d74.3587!16s";
    expect(extractCoordsFromMapsUrl(url)).toEqual({ lat: 31.5204, lng: 74.3587 });
  });

  it("parses @lat,lng", () => {
    expect(extractCoordsFromMapsUrl("https://www.google.com/maps/@24.8607,67.0011,15z")).toEqual({
      lat: 24.8607,
      lng: 67.0011,
    });
  });

  it("parses q=, ll= and query= (incl. encoded comma)", () => {
    expect(extractCoordsFromMapsUrl("https://maps.google.com/?q=33.6844,73.0479")).toEqual({
      lat: 33.6844,
      lng: 73.0479,
    });
    expect(extractCoordsFromMapsUrl("https://maps.google.com/maps?ll=31.5,74.3&z=10")).toEqual({
      lat: 31.5,
      lng: 74.3,
    });
    expect(
      extractCoordsFromMapsUrl("https://www.google.com/maps/search/?api=1&query=31.52%2C74.35")
    ).toEqual({ lat: 31.52, lng: 74.35 });
  });

  it("parses /search/lat,+lng paths", () => {
    expect(extractCoordsFromMapsUrl("https://www.google.com/maps/search/31.5204,+74.3587")).toEqual({
      lat: 31.5204,
      lng: 74.3587,
    });
  });

  it("parses a consent redirect with an encoded continue= URL", () => {
    const url =
      "https://consent.google.com/m?continue=https://www.google.com/maps/place/X/%4031.4,74.2,17z/data%3D!3d31.45!4d74.25&gl=PK";
    expect(extractCoordsFromMapsUrl(url)).toEqual({ lat: 31.45, lng: 74.25 });
  });

  it("returns null for links without coordinates or nonsense", () => {
    expect(extractCoordsFromMapsUrl("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(extractCoordsFromMapsUrl("https://www.google.com/maps/place/Liberty+Market")).toBeNull();
    expect(extractCoordsFromMapsUrl("not a link")).toBeNull();
    expect(extractCoordsFromMapsUrl("https://www.google.com/maps/@999,999,15z")).toBeNull();
    expect(extractCoordsFromMapsUrl("")).toBeNull();
    expect(extractCoordsFromMapsUrl(null)).toBeNull();
  });
});

describe("hosts and short links", () => {
  it("allows only Google hosts", () => {
    expect(isGoogleMapsHost("maps.app.goo.gl")).toBe(true);
    expect(isGoogleMapsHost("www.google.com")).toBe(true);
    expect(isGoogleMapsHost("maps.google.com.pk")).toBe(true);
    expect(isGoogleMapsHost("consent.google.com")).toBe(true);
    expect(isGoogleMapsHost("google.com.evil.com")).toBe(false);
    expect(isGoogleMapsHost("evilgoogle.com")).toBe(false);
    expect(isGoogleMapsHost("127.0.0.1")).toBe(false);
  });

  it("detects short links", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/AbC123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/AbC123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/other")).toBe(false);
    expect(isShortMapsLink("http://maps.app.goo.gl/AbC123")).toBe(false);
  });
});

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe("resolveMapsUrlCoords (short links)", () => {
  it("follows redirects to the coordinates", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://maps.app.goo.gl/")) {
        return redirect("https://www.google.com/maps/place/Shop/@31.5,74.3,17z/data=!3d31.52!4d74.35");
      }
      return new Response("", { status: 200 });
    };
    await expect(resolveMapsUrlCoords("https://maps.app.goo.gl/AbC", { fetchImpl })).resolves.toEqual({
      lat: 31.52,
      lng: 74.35,
    });
    expect(calls).toEqual(["https://maps.app.goo.gl/AbC"]);
  });

  it("refuses to follow redirects to non-Google hosts", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://maps.app.goo.gl/")) return redirect("https://evil.example.com/x");
      return redirect("https://www.google.com/maps/@31.5,74.3,15z");
    };
    await expect(resolveMapsUrlCoords("https://maps.app.goo.gl/AbC", { fetchImpl })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("stops after max hops", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return redirect(`https://maps.app.goo.gl/hop${n}`);
    };
    await expect(resolveMapsUrlCoords("https://maps.app.goo.gl/start", { fetchImpl })).resolves.toBeNull();
    expect(n).toBe(5);
  });

  it("does not fetch long links and returns null on network errors", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      throw new Error("offline");
    };
    await expect(
      resolveMapsUrlCoords("https://www.google.com/maps/place/NoCoords", { fetchImpl })
    ).resolves.toBeNull();
    expect(called).toBe(false);
    await expect(resolveMapsUrlCoords("https://maps.app.goo.gl/x", { fetchImpl })).resolves.toBeNull();
  });
});
