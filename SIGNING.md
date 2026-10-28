# Code signing (Windows)

Windows Smart App Control only runs apps whose signature chains to a publisher Microsoft trusts. Until
the build is signed with a real certificate issued to **AK Vision Systems**, Smart App Control will keep
blocking it. Nothing in this project signs a build until you supply a signing identity, and
`npm run dist:signed` fails instead of producing an unsigned app.

## What you must obtain

You need a **public-trust code-signing certificate issued to AK Vision Systems**. Two routes work with this project:

### Option A (recommended): Microsoft Artifact Signing (formerly "Trusted Signing")
- Cloud service in Azure; no certificate file or hardware token to look after, and certificates renew automatically.
- You need: an Azure subscription, an **Artifact Signing account**, **identity validation** for AK Vision Systems
  (Microsoft checks the legal entity), and a **certificate profile** of type *Public Trust*.
- Eligibility (organisation vs individual, countries, business age) and pricing are set by Microsoft and change,
  so confirm them in the Azure portal before you start.
- Then give the build permission to sign: create an app registration (service principal) and assign it the role
  **Artifact Signing Certificate Profile Signer** on the account (named *Trusted Signing Certificate Profile Signer* in older portals).

### Option B: certificate from a commercial CA (DigiCert, Sectigo, SSL.com, GlobalSign and others)
- Buy an **OV or EV code-signing certificate** in the legal name of AK Vision Systems. Since 2023 the private key must live on
  FIPS-certified hardware, so you receive either a **USB token** or a **cloud-HSM signing service** (for example DigiCert KeyLocker, SSL.com eSigner).
  You cannot get a plain `.pfx` file for a new public-trust certificate.
- Install the CA's signing client so the certificate appears in the Windows certificate store, then note its **SHA-1 thumbprint**.

Either way, the name on the certificate becomes the publisher users see, so it must be the exact legal name you register
(set `AKV_SIGN_PUBLISHER` to match). A self-signed certificate does **not** satisfy Smart App Control.

## Where the credentials go (never in the project or Git)

Create `%USERPROFILE%\.akvision\signing.env` (outside this folder; `npm run dist:signed` loads it automatically, or point
`AKV_SIGNING_ENV` at another path). `.gitignore` also blocks `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.cer`, `signing.env` and `.env*` as a safety net.

Option A:
```
AKV_SIGN_PROVIDER=azure
AKV_SIGN_PUBLISHER=AK Vision Systems
AKV_SIGN_ENDPOINT=https://<region>.codesigning.azure.net
AKV_SIGN_ACCOUNT=<your Artifact Signing account name>
AKV_SIGN_PROFILE=<your certificate profile name>
AZURE_TENANT_ID=<tenant id>
AZURE_CLIENT_ID=<app registration id>
AZURE_CLIENT_SECRET=<app registration secret>
```
(Instead of the three `AZURE_*` lines you can run `az login` first.) The endpoint must match the region of your account.
`AKV_SIGN_PUBLISHER` must equal the certificate subject name Microsoft issues.

Option B:
```
AKV_SIGN_PROVIDER=cert
AKV_SIGN_PUBLISHER=AK Vision Systems
AKV_SIGN_CERT_SHA1=<certificate thumbprint>
# optional: AKV_SIGN_TIMESTAMP_URL=http://timestamp.digicert.com
```
Token/HSM PINs are entered through the CA's own client, not stored here.

## Build and verify

```
npm run dist:signed        # builds installer + portable EXE, signs every EXE/DLL, then verifies
npm run verify:signature   # re-check an existing dist folder
```
The verifier fails unless **every** EXE, DLL and `.node` file in the build has a valid, timestamped signature and the
installer, portable EXE and `Letterhead Maker.exe` are signed by the expected publisher. It prints each output file's
signer and thumbprint. Only treat a build as signed when it ends with
`All signatures are valid and the application is signed by "AK Vision Systems".`

You can also check by hand: right-click the EXE, Properties, *Digital Signatures*, or run
`Get-AuthenticodeSignature "dist\Letterhead Maker 1.0.0.exe"` (Status must be `Valid`).

Even with a valid signature, a brand-new publisher can show a SmartScreen warning until it builds reputation; that is separate from Smart App Control.

## Files
- `electron-builder.signed.js` signing configuration (reads the variables above; contains no secrets)
- `scripts/build-signed.js` loads the settings, builds, then verifies
- `scripts/verify-signature.js` signature check
