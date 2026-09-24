import ImportForm from "./ImportForm";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ org: string; event: string }>;
}) {
  const { org, event } = await params;
  return <ImportForm org={org} event={event} />;
}
