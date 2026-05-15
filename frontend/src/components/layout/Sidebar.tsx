import { NavLink, useParams } from "react-router-dom";

export function Sidebar() {
  const { name } = useParams<{ name: string }>();

  const links = [
    { to: `/projects/${name}`, label: "Workspace", end: true },
    { to: `/projects/${name}/settings`, label: "Settings" },
    { to: `/projects/${name}/activity`, label: "Activity" },
  ];

  return (
    <nav className="w-48 border-r border-gray-200 bg-white p-4 space-y-1">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            `block px-3 py-2 rounded text-sm ${
              isActive ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700 hover:bg-gray-100"
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
