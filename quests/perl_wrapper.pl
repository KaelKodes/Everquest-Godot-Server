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
my $script_path = $args->{script_path};
my $event_type = $args->{event_type} || 'EVENT_SAY';

# Define the quest:: package to intercept calls and emit JSON commands
package quest;
use JSON;

sub emit {
    my ($action, $data) = @_;
    $data->{action} = $action;
    print encode_json($data) . "\n";
}

sub say { emit('say', { text => $_[0] }); }
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

# Provide access to global quest variables (EQEmu plugin compat)
sub val {
    my $varname = shift;
    if ($varname eq '$text') { return $main::text; }
    if ($varname eq '$name') { return $main::name; }
    if ($varname eq '$class') { return $main::class; }
    if ($varname eq '$race') { return $main::race; }
    if ($varname eq '$ulevel') { return $main::ulevel; }
    # Return stub proxy objects for $client and $npc
    if ($varname eq '$client') {
        return bless { name => $main::name }, 'ClientProxy';
    }
    if ($varname eq '$npc') {
        return bless {}, 'NPCProxy';
    }
    return '';
}
sub nullzero { return $_[0] || 0; }
sub random { return $_[int(rand(scalar @_))]; }
sub assocName { return $main::name; }
sub fixNPCName { return ''; }
sub cityName { return ''; }

# Soulbinder plugin (from plugins/soulbinders.pl)
sub soulbinder_say {
    my $text = shift;
    my $pname = $main::name;

    if ($text =~ /hail/i) {
        quest::say("Greetings, ${pname}. When a hero of our world is slain, their soul returns to the place it was last bound and the body is reincarnated. As a member of the Order of Eternity, it is my duty to [bind your soul] to this location if that is your wish.");
    }
    elsif ($text =~ /bind.*soul/i) {
        quest::doanim(42);
        quest::selfcast(2049);
        quest::emit('message', { color => 4, text => "You feel yourself bind to the area." });
    }
}

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

package main;

# Execute the script
do $script_path;
if ($@) {
    quest::emit('error', { text => "Couldn't parse $script_path: $@" });
}

# Call the appropriate event function if it exists
if ($event_type eq 'EVENT_SAY' && defined &EVENT_SAY) {
    EVENT_SAY();
} elsif ($event_type eq 'EVENT_ITEM' && defined &EVENT_ITEM) {
    EVENT_ITEM();
} elsif ($event_type eq 'EVENT_COMBAT' && defined &EVENT_COMBAT) {
    EVENT_COMBAT();
} elsif ($event_type eq 'EVENT_DEATH' && defined &EVENT_DEATH) {
    EVENT_DEATH();
}

exit 0;
