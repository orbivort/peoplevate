# Peoplevate Documentation

This directory holds the user-facing documentation for **Peoplevate**, an open-source
Employee Lifecycle Management System. It is the primary reference for operators,
administrators, HR staff, and API consumers who install and run the product.

## Documentation Set

| Document                                      | Audience                               | Purpose                                                                                             |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Usage Guide](./usage-guide.md)               | All users, HR, managers, admins        | How to use each functional module, role-based workflows, and frontend routes. Start here.           |
| [Roles & Permissions](./roles-permissions.md) | Admins, HR managers, operators         | The RBAC role matrix and capability mapping across the system.                                      |
| [API Overview](./api-overview.md)             | API consumers, integrators, developers | REST endpoint reference for the backend API.                                                        |
| [Deployment](./deployment.md)                 | Operators, DevOps, admins              | How to deploy and operate Peoplevate in production, including the recommended Docker Compose stack. |

## Where Things Live

- **Product README** — [`../README.md`](../README.md) covers prerequisites, installation, common scripts, and environment variables.
- **Contributing** — [`../CONTRIBUTING.md`](../CONTRIBUTING.md) covers development setup, conventions, and testing.
- **Security policy** — [`../SECURITY.md`](../SECURITY.md) describes how to report vulnerabilities.

## Suggested Reading Order

1. **Deployment** — if you are standing up Peoplevate for the first time.
2. **Usage Guide** — to understand how the application behaves from the user's perspective.
3. **Roles & Permissions** — to plan accounts and understand access control.
4. **API Overview** — if you plan to integrate with or extend the API.
