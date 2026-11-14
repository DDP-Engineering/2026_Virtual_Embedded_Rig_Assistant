"""Writes the TLS fixture of the mqtt-tools tests into one folder (argv[1]), with the cryptography package.

ca.pem signs server.pem (localhost, 127.0.0.1) and wronghost.pem (wrong.example only); other-ca.pem is an
unrelated CA. Keys are unencrypted test keys that live only in the test's temporary folder.
"""

import datetime
import ipaddress
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

out = Path(sys.argv[1])
now = datetime.datetime.now(datetime.timezone.utc)


def name(common: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common)])


def save(stem: str, cert: x509.Certificate, key=None) -> None:
    (out / f"{stem}.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    if key is not None:
        (out / f"{stem}.key").write_bytes(
            key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        )


def ca(common: str):
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(name(common))
        .issuer_name(name(common))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    return key, cert


def leaf(common: str, names: list, issuer_key, issuer: x509.Certificate):
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(name(common))
        .issuer_name(issuer.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=2))
        .add_extension(x509.SubjectAlternativeName(names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(
                issuer.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value
            ),
            critical=False,
        )
        .sign(issuer_key, hashes.SHA256())
    )
    return key, cert


ca_key, ca_cert = ca("VERA test CA")
save("ca", ca_cert)
_, other = ca("Unrelated test CA")
save("other-ca", other)
key, cert = leaf("localhost", [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))], ca_key, ca_cert)
save("server", cert, key)
key, cert = leaf("wrong.example", [x509.DNSName("wrong.example")], ca_key, ca_cert)
save("wronghost", cert, key)
print("ok")
