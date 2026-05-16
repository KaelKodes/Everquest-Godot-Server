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
# PEQ scripts compare $class to title-case names (e.g. "Paladin"); prefer class_name from Node.
our $class = $args->{class_name} || $args->{class} || '';
our $race = $args->{race} || '';
our $ulevel = $args->{ulevel} || 1;
our %itemcount = %{ $args->{itemcount} || {} };
our $item1 = $args->{item1} || 0;
our $item2 = $args->{item2} || 0;
our $item3 = $args->{item3} || 0;
our $item4 = $args->{item4} || 0;
our $platinum = $args->{platinum} || 0;
our $gold = $args->{gold} || 0;
our $silver = $args->{silver} || 0;
our $copper = $args->{copper} || 0;

# Stubs for plugin::val('$client') / plugin::val('$npc') via globals.pl (package plugin)
# qg = in-memory quest globals for this Perl invocation (persisted qglobals would need Node/DB).
our $client = bless { name => $name, qg => ($args->{qglobals} || {}) }, 'ClientProxy';
our $npc = bless {}, 'NPCProxy';
our $item1_inst = bless { item_id => $item1 }, 'ItemInstProxy';
our $item2_inst = bless { item_id => $item2 }, 'ItemInstProxy';
our $item3_inst = bless { item_id => $item3 }, 'ItemInstProxy';
our $item4_inst = bless { item_id => $item4 }, 'ItemInstProxy';
my $script_path = $args->{script_path};
my $event_type = $args->{event_type} || 'EVENT_SAY';

# Define the quest:: package to intercept calls and emit JSON commands
# (Must exist before plugin stubs that call quest::say / quest::emit.)
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
# Minimal stubs — MUST load before quests/plugins/*.pl so PEQ files override them.
# default-actions.pl must use the same prototype as this stub (none). Empty () on either side
# causes "Prototype mismatch" or "Constant subroutine redefined" when the other loads.
sub defaultSay { 1; }
sub defaultItem { 1; }
sub defaultCombat { 1; }
sub defaultSlay { 1; }
sub defaultDeath { 1; }

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

# EQEmu qglobals — many epics use $client->GetGlobal("name"). Return "" when unset (numeric compares stay false).
sub GetGlobal {
    my ($self, $key) = @_;
    return '' unless defined $key;
    my $qg = $self->{qg} || {};
    return $qg->{$key} if exists $qg->{$key};
    return '';
}

sub SetGlobal {
    my ($self, $key, $value, $opts, $duration) = @_;
    return unless defined $key;
    $self->{qg}{$key} = defined $value ? $value : '';
    return 1;
}

sub DeleteGlobal {
    my ($self, $key) = @_;
    return unless defined $key;
    delete $self->{qg}{$key};
    return 1;
}

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

package ItemInstProxy;
sub GetID { return $_[0]->{item_id}; }

# Load all plugins from the plugins directory (override stubs above)
my $plugins_dir = $args->{quests_dir} . '/plugins';
if (-d $plugins_dir) {
    opendir(my $dh, $plugins_dir) || die "Can't opendir $plugins_dir: $!";
    while (my $file = readdir($dh)) {
        next if ($file =~ /^\./);
        if ($file =~ /\.pl$/i) {
            my $path = "$plugins_dir/$file";
            eval {
                package plugin;
                do $path;
                1;
            } or warn "Quest plugin $file: $@\n";
        }
    }
    closedir($dh);
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
