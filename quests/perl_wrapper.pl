#!/usr/bin/perl
use strict;
use warnings;
use JSON;

# Read arguments from JSON passed via command line
my $json_arg = $ARGV[0] || '{}';
my $args = decode_json($json_arg);

# Populate global variables expected by EQEmu Perl scripts
our $text = $args->{text} || '';
our $name = $args->{name} || '';
our $class = $args->{class} || '';
our $race = $args->{race} || '';
our $ulevel = $args->{ulevel} || 1;
our %itemcount = %{ $args->{itemcount} || {} };
# Stubs for plugin::val('$client') / plugin::val('$npc') via globals.pl (package plugin)
our $client = bless { name => $name }, 'ClientProxy';
our $npc = bless {}, 'NPCProxy';
my $script_path = $args->{script_path};
my $event_type = $args->{event_type} || 'EVENT_SAY';

# Load all plugins from the plugins directory
my $plugins_dir = $args->{quests_dir} . '/plugins';
if (-d $plugins_dir) {
    opendir(my $dh, $plugins_dir) || die "Can't opendir $plugins_dir: $!";
    while (my $file = readdir($dh)) {
        next if ($file =~ /^\./);
        if ($file =~ /\.pl$/i) {
            # Use do() so plugins need not end with `1;` (PEQ require() would die otherwise).
            my $path = "$plugins_dir/$file";
            eval { do $path; 1 } or warn "Quest plugin $file: $@\n";
        }
    }
    closedir($dh);
}

# Define the quest:: package to intercept calls and emit JSON commands
package quest;
use JSON;

sub emit {
    my ($action, $data) = @_;
    $data->{action} = $action;
    print encode_json($data) . "\n";
}

sub say { emit('say', { text => $_[0] }); }
# EQEmu quest::saylink(phrase, unused, display) — phrase only; scripts wrap in brackets
sub saylink {
    my ($phrase, $unused, $display) = @_;
    return (defined($display) && $display ne '') ? $display : $phrase;
}
sub shout { emit('shout', { text => $_[0] }); }
sub emote { emit('emote', { text => $_[0] }); }
sub summonitem { emit('summonitem', { item_id => $_[0], count => $_[1] || 1 }); }
sub exp { emit('exp', { amount => $_[0] }); }
sub ding { emit('ding', {}); }
sub me { emit('message', { color => 15, text => $_[0] }); }
sub taskselector { emit('taskselector', { task_id => $_[0] }); }
sub faction { emit('faction', { faction_id => $_[0], amount => $_[1] }); }
sub depop { emit('depop', { timer => $_[0] || 0 }); }
sub depop_withtimer { emit('depop', { timer => 1 }); }
sub spawn2 { emit('spawn2', { npc_id => $_[0], grid => $_[1], unused => $_[2], x => $_[3], y => $_[4], z => $_[5], h => $_[6] }); }
sub doanim { emit('anim', { anim => $_[0] }); }
sub selfcast { emit('cast', { spellId => $_[0] }); }
sub popup { emit('popup', { title => $_[0], text => $_[1] }); }
sub givecash { emit('givecash', { copper => $_[0] || 0, silver => $_[1] || 0, gold => $_[2] || 0, platinum => $_[3] || 0 }); }
sub setglobal { emit('setglobal', { name => $_[0], value => $_[1], options => $_[2], duration => $_[3] }); }
sub targlobal { 1; }

package plugin;

# val, nullzero, random, var, takeItems, etc. come from globals.pl (also package plugin).
# Minimal stubs not provided by globals:
sub assocName { return $main::name; }
sub fixNPCName { return ''; }
sub cityName { return ''; }

sub return_items {
    my $items = shift;
    my @returned = ();
    my $has_items = 0;
    foreach my $item_id (keys %$items) {
        my $count = $items->{$item_id};
        for (my $i = 0; $i < $count; $i++) {
            push(@returned, int($item_id));
            $has_items = 1;
        }
    }
    if ($has_items) {
        quest::say("I have no need for this, $name, you can have it back.");
        quest::emit('return_items', { returned => \@returned });
    }
}

sub returnUnusedItems { return_items(\%main::itemcount); }

# Stub proxy for $client->GetName(), $client->Message(), etc.
package ClientProxy;
sub GetName { return $_[0]->{name}; }
sub Message { quest::emit('message', { color => $_[1], text => $_[2] }); }

# Minimal NPC proxy for plugin::takeItems / givenItems (globals.pl) — mutates hand-in hash like EQEmu CheckHandin
package NPCProxy;
sub CheckHandin {
    my ($self, $client, $handin, $required, @item_insts) = @_;
    return 0 unless ref($handin) eq 'HASH' && ref($required) eq 'HASH';
    for my $k (keys %$required) {
        my $need = $required->{$k};
        next if !defined($need) || $need <= 0;
        my $have = $handin->{$k} || 0;
        return 0 if $have < $need;
    }
    for my $k (keys %$required) {
        my $need = $required->{$k};
        next if !defined($need) || $need <= 0;
        $handin->{$k} = ($handin->{$k} || 0) - $need;
        delete $handin->{$k} if ($handin->{$k} <= 0);
    }
    return 1;
}

package main;

# Execute the script
do $script_path;
if ($@) {
    quest::emit('error', { text => "Couldn't parse $script_path: $@" });
}

# Call the appropriate event function if it exists
if ($event_type eq 'EVENT_SAY' && defined &EVENT_SAY) {
    EVENT_SAY();
} elsif (($event_type eq 'EVENT_ITEM' || $event_type eq 'EVENT_TRADE') && defined &EVENT_ITEM) {
    EVENT_ITEM();
} elsif ($event_type eq 'EVENT_COMBAT' && defined &EVENT_COMBAT) {
    EVENT_COMBAT();
} elsif ($event_type eq 'EVENT_DEATH' && defined &EVENT_DEATH) {
    EVENT_DEATH();
}

exit 0;
