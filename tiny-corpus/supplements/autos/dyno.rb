# Dyno chart parser
class DynoRun
  attr_reader :rpm, :hp, :torque

  def initialize(rpm, hp, torque)
    @rpm = rpm
    @hp = hp
    @torque = torque
  end

  def self.peak(runs, key)
    runs.max_by { |r| r.send(key) }
  end
end

runs = [
  DynoRun.new(2000, 180, 425),
  DynoRun.new(3500, 320, 480),
  DynoRun.new(5000, 410, 430),
  DynoRun.new(6500, 425, 343),
]

peak_hp = DynoRun.peak(runs, :hp)
peak_tq = DynoRun.peak(runs, :torque)
puts "Peak HP: #{peak_hp.hp} @ #{peak_hp.rpm}"
puts "Peak Torque: #{peak_tq.torque} @ #{peak_tq.rpm}"
