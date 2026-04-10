import { PublicDashboardIsland } from "../islands/dashboard/PublicDashboardIsland.tsx";
import { Breadcrumb } from "../ui/Breadcrumb.tsx";
import * as m from "../paraglide/messages.js";

export default function PerfilPage() {
	return (
		<>
			<Breadcrumb items={[
				{ label: m.nav_home(), href: "/" },
				{ label: m.profile_title() },
			]} />
			<PublicDashboardIsland />
		</>
	);
}
