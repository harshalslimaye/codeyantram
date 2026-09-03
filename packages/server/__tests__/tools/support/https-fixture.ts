// web_fetch's URL policy (url-policy.ts) requires https unconditionally, even for a
// loopback target under WEB_FETCH_ALLOW_PRIVATE - so a fixture server for its tests has
// to speak real TLS, not plain HTTP. This is a long-lived (100-year) self-signed
// certificate for 127.0.0.1 checked in purely as a test fixture; it authenticates
// nothing and signs nothing outside this test run.
//
// Bun's fetch() won't trust a self-signed cert by default, so any test file using this
// fixture must set process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' for the duration
// (restored afterward) - see web-fetch.test.ts's beforeAll/afterAll.
export const FIXTURE_CERT = `-----BEGIN CERTIFICATE-----
MIICwDCCAaigAwIBAgIJAKH1cZSmo6NdMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCTEyNy4wLjAuMTAgFw0yNjA5MDMwMjI2MjBaGA8yMTI2MDgxMDAyMjYyMFow
FDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAoomZkRSygPhfhJMzjTkWezWiOjd2JFovEn9IYRN/O03AAXsGGOAxB71P
ii0ajIBCLiaiFWaUdPiQqrTB6D+5FT4CNhihFq9kH3qK4yF8ZlbZ3eAdMbR7zvWd
hBcmYvpIM1z81qK7LUNUaQMpyLUHtxZlFAR/KuwUFEOWthQLz+rFlB3Q3QDEZwoQ
uTnWrGNUGsU/C1cpN0bcTUG5s87lQ53gfv1co2GXILbszutA9GFUjM/Uq5rfdg+N
PUcrtk3iRhpy10crXPi9gsEkxUhLvvHnOd8TcvSo9XZ2l0xXgfxYWZPhnWDGNC8i
1xZVa0RATvMNB17HeKav3dLq76IzTwIDAQABoxMwETAPBgNVHREECDAGhwR/AAAB
MA0GCSqGSIb3DQEBCwUAA4IBAQCT2SejwJycdgNj5a/+VIx/dtwV4BLeoVJ+Tnnc
s35oWSxCMB9LVqgmyLKaT6UxzSzZpqNtJ4EHTZZeNo8o1V8Lprg3ALCITg3rFXFn
hgH3CqXebHB+gJKwO9mu+U9jHCTcy/oE0ioklF9D7vj1KA32qw6oFl6rQBPkLjCT
bQ4mmtN8/33MroB1EZNpoSSaNBi3GmfRr1ItvCcQmIuGV8KpecP3xb7njlBjtR3p
KatCcVO5W+PjM7mka/Vs/hIdl6vt+aISkQQwQfsg1Rd6fdhj1axUZbsOPS7rWkNP
jpE/OZZiylZnUGR0ly45mKPZr+Q1/fsugdjoePNYfFRpqJBv
-----END CERTIFICATE-----
`;

export const FIXTURE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCiiZmRFLKA+F+E
kzONORZ7NaI6N3YkWi8Sf0hhE387TcABewYY4DEHvU+KLRqMgEIuJqIVZpR0+JCq
tMHoP7kVPgI2GKEWr2QfeorjIXxmVtnd4B0xtHvO9Z2EFyZi+kgzXPzWorstQ1Rp
AynItQe3FmUUBH8q7BQUQ5a2FAvP6sWUHdDdAMRnChC5OdasY1QaxT8LVyk3RtxN
QbmzzuVDneB+/VyjYZcgtuzO60D0YVSMz9Srmt92D409Ryu2TeJGGnLXRytc+L2C
wSTFSEu+8ec53xNy9Kj1dnaXTFeB/FhZk+GdYMY0LyLXFlVrREBO8w0HXsd4pq/d
0urvojNPAgMBAAECggEAN9+3c8E6r80yAMAdi6GhUc+ZKgwgx9RctC4fMofiR/+t
TpT8/pYrJK72ZdildMEufvD27QZraF5+VMB4nB8zv9KmLfR/g+3dLFkS34uGWSPo
FzbQsmKJ4RZcBKl0n7fMFCQWIq6kS6YGoWbd+UoKEe1X5+63zIiFSoYFjCgN+3X7
/JaZwLcpndILbr68GG5jzzAp5VnXuBf4XswU+gga2G+/QDczroPp1XHRyZhd15kt
iBum+GxeLkdmax4HU6JoE1hGtPerKNuCLeXMLCfgBqW8UYrCsmZC2rIcZrizkjke
2IM9IWQwP3B1auiB/MArpAWG8tP+V+x3nieShkcmkQKBgQDVXPslxJ4HUnMZ9Dyd
bjEPK9vcnymeMzmj+Jya7pUENcx464RCto+svgAIcNOiViGSacEhPM4A3yULfwX1
TFzZnDpPMUYjlmYw3khkpMagk0vf/ALssD79KoOO1me+6arwFtTcZebXaBPPOYmA
yBWGSs6vHUHD9sFtby0w8zSImQKBgQDDBIdaadZsQTGf6X87I4KdgJZaZPQ0MNwo
/jkmeSv17uo2v8XTiJ/eTXJTBFsZq3+Mq4+GGrti2VmERXK9SWOiYwil8lwpR5IM
ipBikEBCqGg2lrIvRQ5+aK5OEawbS2pzaYE+OtA9aWMe2ixb2xNzXpFlfVuCTFT2
3D4cGNcEJwKBgQCFnRnF+BACg9aCzVlcOVJNruibi6zTXj7deWYQ/BGjtlEa9Fo6
MPtecQmyP3247nlNqB6CwwI6t4MKZPyFNdH7kINPbor+5EOQnNL2+91LV5KvbLEk
Keb4QbRrMcd8XfZnLdUVRFdAU/P71ItQc3xPQe+W6Bp0LsXI01OYkOU4GQKBgH1W
A8fQDcc1fzdPUj4n7GJdqkQebfS9EkImYYSgi+hbzJuzVOlG/bhZ/gfs3L/6wNcf
y/ZcZ+J33lhsafnNmQNcsso0oZbGMM9unq06GJK+uXucDpjiwRXtIVl7cil4psnW
HQJpujw95z6E6c1/V1jmhnu7vXxYoqKlmiVksYwxAoGAXQdF4EQnVgotehpAhbVc
ONsre76tQTInSn7znx0QSI75tME478tP8KxZVYaMPXlLrT8bO06b+GzlbL4ukuzZ
j19YLBL/V7psAmHZCEGq4g3mjEdjcrmj843WIiTE8wkbhMNJ5NAV5rwXowRp0oc4
mDAJQcCHFkjZDd+0HTBPBdo=
-----END PRIVATE KEY-----
`;

/** Starts an HTTPS fixture server on an ephemeral 127.0.0.1 port using the cert above.
 * Callers are responsible for `server.stop(true)` and for the NODE_TLS_REJECT_UNAUTHORIZED
 * env dance described up top. */
export function startHttpsFixture(fetch: (request: Request) => Response | Promise<Response>) {
    return Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        tls: { cert: FIXTURE_CERT, key: FIXTURE_KEY },
        fetch,
    });
}
