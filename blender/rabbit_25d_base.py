import bpy, math
from mathutils import Vector

# 清空场景
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def mat(name, color, roughness=0.55):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.roughness=roughness; return m

fur=mat('Rabbit_Cream_Fur',(0.92,0.72,0.62)); inner=mat('Ear_Pink',(1.0,0.35,0.38)); dark=mat('Eyes',(0.025,0.012,0.01),0.2); white=mat('Eye_Highlight',(1,1,1),0.15); scarf=mat('Scarf_Coral',(0.9,0.16,0.12))

def uv(name, loc, scale, material, seg=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); o.data.materials.append(material); bpy.ops.object.shade_smooth(); return o

def cube(name, loc, scale, material, bevel=0.15):
    bpy.ops.mesh.primitive_cube_add(location=loc); o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); o.data.materials.append(material)
    b=o.modifiers.new('Soft_edges','BEVEL'); b.width=bevel; b.segments=3; return o

# 身体、头、四肢
uv('Body',(0,0,1.65),(0.72,0.48,1.0),fur)
uv('Head',(0,-0.02,3.05),(0.9,0.7,0.78),fur)
uv('Foot_L',(-0.38,-0.08,0.72),(0.42,0.5,0.22),fur); uv('Foot_R',(0.38,-0.08,0.72),(0.42,0.5,0.22),fur)
uv('Arm_L',(-0.7,-0.02,1.9),(0.2,0.24,0.58),fur); uv('Arm_R',(0.7,-0.02,1.9),(0.2,0.24,0.58),fur)
# 耳朵
for x,rot in [(-0.42,-0.15),(0.42,0.15)]:
    ear=uv('Ear', (x,0,3.98),(0.28,0.22,0.85),fur); ear.rotation_euler[1]=rot
    pink=uv('Ear_Inner',(x,-0.2,3.98),(0.14,0.06,0.58),inner); pink.rotation_euler[1]=rot
# 眼睛和高光
for x in (-0.32,0.32):
    uv('Eye',(x,-0.63,3.18),(0.18,0.08,0.23),dark); uv('Eye_Spark',(x-0.05,-0.71,3.27),(0.045,0.025,0.055),white,16,8)
uv('Nose',(0,-0.7,2.93),(0.11,0.07,0.08),inner)
uv('Tail',(0,0.46,1.52),(0.28,0.25,0.28),fur)
# 围巾
cube('Scarf',(0,-0.02,2.45),(0.78,0.55,0.12),scarf,0.12)
cube('Scarf_Tail',(0.45,-0.06,2.15),(0.16,0.5,0.08),scarf,0.08)

# 地面与灯光
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0.48)); floor=bpy.context.object; floor.name='Ground'; floor.data.materials.append(mat('Ground_Mat',(0.18,0.28,0.14)))
bpy.ops.object.light_add(type='AREA', location=(3,-4,6)); key=bpy.context.object; key.name='Key_Light'; key.data.energy=900; key.data.shape='DISK'; key.data.size=5; key.rotation_euler=(math.radians(25),0,math.radians(35))
bpy.ops.object.light_add(type='AREA', location=(-3,1,3)); fill=bpy.context.object; fill.data.energy=500; fill.data.size=4

# 相机
bpy.ops.object.camera_add(location=(0,-10,3.0)); cam=bpy.context.object; bpy.context.scene.camera=cam; cam.rotation_euler=(math.radians(82),0,0)
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE_NEXT'; scene.render.resolution_x=600; scene.render.resolution_y=800; scene.render.resolution_percentage=100
scene.world.color=(0.06,0.09,0.12)

# 便于后续骨骼绑定的集合
root=bpy.data.collections.new('RABBIT_CHARACTER'); scene.collection.children.link(root)
for o in list(bpy.context.scene.objects):
    if o.name not in {'Camera','Key_Light'} and o.users_collection:
        for c in list(o.users_collection): c.objects.unlink(o)
        root.objects.link(o)

bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath('//rabbit_base.blend'))
print('Rabbit base created and saved as rabbit_base.blend')
