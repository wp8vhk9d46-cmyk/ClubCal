import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type ClubRow = {
  id: string;
  name: string;
};

type EventRow = {
  id: string;
  user_id: string | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  address: string | null;
  room: string | null;
  attire: string | null;
  category: string | null;
  description: string | null;
  rsvp_url: string | null;
  created_at: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function escapeICS(value: string | null | undefined) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toUtcStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join("") + "T" + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join("") + "Z";
}

function fmt(dateStr: string, timeStr: string) {
  const clean = `${dateStr}T${timeStr.substring(0, 5)}:00`;
  const date = new Date(clean);
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildEventBlock(eventItem: EventRow, clubName: string) {
  const descriptionLines = [
    eventItem.description || "",
    eventItem.attire ? `Attire: ${eventItem.attire}` : "",
    eventItem.category ? `Category: ${eventItem.category}` : "",
    eventItem.rsvp_url ? `RSVP: ${eventItem.rsvp_url}` : ""
  ].filter(Boolean);

  const location = [eventItem.address, eventItem.room].filter(Boolean).join(", ");
  const dtstamp = toUtcStamp(new Date());
  const dtstart = fmt(eventItem.date, eventItem.start_time);
  const dtend = fmt(eventItem.date, eventItem.end_time);

  return [
    "BEGIN:VEVENT",
    `UID:${escapeICS(`${eventItem.id}@clubcal.app`)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeICS(`${eventItem.title} - ${clubName}`)}`,
    `DESCRIPTION:${escapeICS(descriptionLines.join("\n"))}`,
    `LOCATION:${escapeICS(location)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT"
  ].join("\r\n");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const clubId = url.searchParams.get("club_id") || url.searchParams.get("club");

  if (!clubId) {
    return new Response("Missing club_id query parameter.", {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Supabase environment is not configured.", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("*")
    .eq("club_id", clubId);

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("name")
    .eq("id", clubId)
    .single<ClubRow>();

  console.log("clubId:", clubId);
  console.log("events:", JSON.stringify(events));
  console.log("eventsError:", JSON.stringify(eventsError));
  console.log("club:", JSON.stringify(club));
  console.log("clubError:", JSON.stringify(clubError));

  if (url.searchParams.get("debug") === "true") {
    return new Response(JSON.stringify({ clubId, events, eventsError, club, clubError }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (clubError) {
    return new Response(clubError.message, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  if (eventsError) {
    return new Response(eventsError.message, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  if (!club) {
    return new Response("Club not found.", {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const calendarBody = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Club Cal//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(club.name)}`,
    `X-WR-CALDESC:${escapeICS(`Live event feed for ${club.name}`)}`,
    ...((events || []) as EventRow[])
      .sort((a, b) => {
        const left = `${a.date || ""}T${a.start_time || ""}`;
        const right = `${b.date || ""}T${b.start_time || ""}`;
        return left.localeCompare(right);
      })
      .map((eventItem) => buildEventBlock(eventItem, club.name)),
    "END:VCALENDAR"
  ].join("\r\n");

  return new Response(calendarBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Content-Disposition": `inline; filename="${club.id}.ics"`
    }
  });
});
