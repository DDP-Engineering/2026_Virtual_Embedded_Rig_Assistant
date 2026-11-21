import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createSecureContext } from "node:tls";

// A short-lived X.509 leaf for the loopback proxy. Chrome trusts only this
// session's public key. Public server certificates are verified by Node.
export function createProxyIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const algorithm = der(0x30, Buffer.from("06082a8648ce3d040302", "hex")); // ECDSA with SHA-256
  const name = der(
    0x30,
    der(0x31, der(0x30, Buffer.from("0603550403", "hex"), der(0x0c, Buffer.from("VERA browser")))),
  );
  const now = Date.now();
  const serial = Buffer.concat([Buffer.from([1]), randomBytes(15)]);
  const body = der(
    0x30,
    der(0x02, serial),
    algorithm,
    name,
    der(0x30, time(now - 3_600_000), time(now + 86_400_000)),
    name,
    spki,
  );
  const signature = der(0x03, Buffer.from([0]), sign("sha256", body, privateKey));
  const certificate = der(0x30, body, algorithm, signature);
  return {
    tls: createSecureContext({
      cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64")}\n-----END CERTIFICATE-----\n`,
      key: privateKey.export({ format: "pem", type: "pkcs8" }),
      minVersion: "TLSv1.2",
    }),
    spki: createHash("sha256").update(spki).digest("base64"),
  };
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length = body.length;
  const size = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >> 8, length & 255];
  return Buffer.concat([Buffer.from([tag, ...size]), body]);
}

function time(value: number): Buffer {
  const stamp = new Date(value).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return der(0x18, Buffer.from(`${stamp}Z`));
}
