import { getBaseUrl } from "../lib/paths.ts";
import "./LicenseBadge.css";

// Botones oficiales de Creative Commons (88×31), servidos en local para no
// depender de licensebuttons.net. Identifican la licencia; no la sustituyen.
interface LicenseBadgeSpec {
	href: string;
	label: string;
	file: string;
}

const LICENSE_BADGES: Record<string, LicenseBadgeSpec> = {
	"cc-by": {
		href: "https://creativecommons.org/licenses/by/4.0/",
		label: "Licencia Creative Commons Reconocimiento 4.0",
		file: "cc-by.png",
	},
	"cc-by-sa": {
		href: "https://creativecommons.org/licenses/by-sa/4.0/",
		label: "Licencia Creative Commons Reconocimiento-CompartirIgual 4.0",
		file: "cc-by-sa.png",
	},
	"cc-by-nc": {
		href: "https://creativecommons.org/licenses/by-nc/4.0/",
		label: "Licencia Creative Commons Reconocimiento-NoComercial 4.0",
		file: "cc-by-nc.png",
	},
	"cc-by-nc-sa": {
		href: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
		label:
			"Licencia Creative Commons Reconocimiento-NoComercial-CompartirIgual 4.0",
		file: "cc-by-nc-sa.png",
	},
	"cc-by-nd": {
		href: "https://creativecommons.org/licenses/by-nd/4.0/",
		label: "Licencia Creative Commons Reconocimiento-SinObraDerivada 4.0",
		file: "cc-by-nd.png",
	},
	"cc-by-nc-nd": {
		href: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
		label:
			"Licencia Creative Commons Reconocimiento-NoComercial-SinObraDerivada 4.0",
		file: "cc-by-nc-nd.png",
	},
	cc0: {
		href: "https://creativecommons.org/publicdomain/zero/1.0/",
		label: "Licencia CC0 1.0 Universal, dominio público",
		file: "cc0.png",
	},
};

export function licenseBadgeFor(license: string): {
	href: string;
	label: string;
	image: string;
} | null {
	const spec = LICENSE_BADGES[license.trim().toLowerCase()];
	if (!spec) return null;
	const base = getBaseUrl();
	const prefix = base.endsWith("/") ? base : `${base}/`;
	return {
		href: spec.href,
		label: spec.label,
		image: `${prefix}licenses/${spec.file}`,
	};
}

export function LicenseBadge({ license }: { license: string }) {
	const spec = licenseBadgeFor(license);
	if (!spec) {
		return <span className="detail-license-text">{license}</span>;
	}

	return (
		<a
			className="license-badge"
			href={spec.href}
			rel="license noopener noreferrer"
			target="_blank"
		>
			<img src={spec.image} alt={spec.label} width={88} height={31} />
		</a>
	);
}
