import { useLocation } from "react-router-dom";
import { PublicCollectionsIsland } from "../islands/collections/PublicCollectionsIsland.tsx";
import "../styles/catalog.css";

export default function ColeccionesPage() {
	// La isla escribe en el historial por su cuenta y solo relee la URL al
	// montarse o con «atrás». El enlace «Colecciones» de la cabecera navega con
	// el router sin lanzar `popstate`: la clave la remonta para que lea la URL.
	const { key } = useLocation();
	return <PublicCollectionsIsland key={key} />;
}
